// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./mospi", async () => {
  const actual = await vi.importActual<typeof import("./mospi")>("./mospi");
  return { ...actual, callTool: vi.fn() };
});

import { DEFAULT_INDICATORS } from "./defaults";
import { fetchSeries, refreshIndicators } from "./indicators";
import { callTool, MospiError } from "./mospi";
import type { IndicatorDef, IndicatorValue } from "./types";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", "mospi", name), "utf8"));

const NOW = new Date("2026-09-26T12:00:00.000Z");
const byId = (id: string) => DEFAULT_INDICATORS.find((d) => d.id === id)!;

type Args = { dataset: string; filters: Record<string, string> };

// Answers get_data from the responses recorded on 2026-09-26.
function recordedMospi(_name: string, args: Record<string, unknown>) {
  const { dataset, filters } = args as Args;
  if (dataset === "CPI" && filters.division_code === "0") return fixture("cpi-general.json");
  if (dataset === "CPI" && filters.division_code === "1") return fixture(`cpi-food-p${filters.page}.json`);
  if (dataset === "IIP") return fixture("iip-general.json");
  if (dataset === "NAS") return fixture("nas-gdp-growth.json");
  if (dataset === "PLFS") return fixture("plfs-urban-ur.json");
  throw new Error(`no fixture for ${dataset}`);
}

describe("fetchSeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callTool).mockImplementation(async (name, args) => recordedMospi(name, args));
  });

  it.each([
    ["cpi-headline", { period: "Jul 2026", value: 4.45 }, { period: "Aug 2026", value: 4.82 }],
    ["cpi-food", { period: "Jul 2026", value: 5.24 }, { period: "Aug 2026", value: 5.66 }],
    ["iip", { period: "Jun 2026", value: 8.8 }, { period: "Jul 2026", value: 6.7 }],
    ["gdp", { period: "Q4 2025-26", value: 8.6 }, { period: "Q1 2026-27", value: 7.8 }],
    ["unemployment-urban", { period: "Jul 2026", value: 6.7 }, { period: "Aug 2026", value: 6.8 }],
  ])("default %s reads its latest two points from the recorded response", async (id, prev, latest) => {
    const points = await fetchSeries(byId(id));
    expect(points.slice(-2)).toEqual([prev, latest]);
  });

  it("sends limit 100 and page 1, MoSPI's maximum page size", async () => {
    await fetchSeries(byId("iip"));
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith("get_data", {
      dataset: "IIP",
      filters: { base_year: "2022-23", frequency: "Monthly", type: "General", limit: "100", page: "1" },
    });
  });

  it("pages a matched definition until it has two points, and no further", async () => {
    await fetchSeries(byId("cpi-food"));
    expect(vi.mocked(callTool).mock.calls.map(([, a]) => (a as Args).filters.page)).toEqual(["1", "2", "3"]);
  });

  it("stops paging a matched definition after four pages", async () => {
    vi.mocked(callTool).mockImplementation(async () => fixture("cpi-food-p2.json"));
    await expect(fetchSeries(byId("cpi-food"))).rejects.toThrow("MoSPI returned no values for these filters");
    expect(callTool).toHaveBeenCalledTimes(4);
  });

  it("fails rather than mixing series when the filters match more than one", async () => {
    const unmatched: IndicatorDef = { ...byId("cpi-food"), match: undefined };
    await expect(fetchSeries(unmatched)).rejects.toThrow(/filters match more than one series/);
  });

  it("fails when MoSPI finds no rows", async () => {
    vi.mocked(callTool).mockResolvedValue({ data: [], msg: "No Data Found", statusCode: true });
    await expect(fetchSeries(byId("iip"))).rejects.toThrow("MoSPI returned no values for these filters");
  });
});

describe("refreshIndicators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the latest two points of every definition, in order", async () => {
    vi.mocked(callTool).mockImplementation(async (name, args) => recordedMospi(name, args));
    const values = await refreshIndicators(DEFAULT_INDICATORS, [], NOW);
    expect(values.map((v) => v.id)).toEqual(DEFAULT_INDICATORS.map((d) => d.id));
    expect(values[0]).toEqual({
      id: "cpi-headline",
      label: "Retail inflation",
      unit: "%",
      period: "Aug 2026",
      latest: 4.82,
      prevPeriod: "Jul 2026",
      prev: 4.45,
      lastGoodAt: NOW.toISOString(),
    });
  });

  it("keeps the previous values and lastGoodAt when a query fails", async () => {
    vi.mocked(callTool).mockRejectedValue(new MospiError("MoSPI status 503"));
    const previous: IndicatorValue = {
      id: "iip",
      label: "IIP growth",
      unit: "%",
      period: "Jun 2026",
      latest: 8.8,
      prevPeriod: "May 2026",
      prev: 5,
      lastGoodAt: "2026-09-20T08:00:00.000Z",
    };
    const [value] = await refreshIndicators([byId("iip")], [previous], NOW);
    expect(value).toEqual({ ...previous, error: "MoSPI status 503" });
  });

  it("returns an empty row with the error when an indicator has never loaded", async () => {
    vi.mocked(callTool).mockRejectedValue(new MospiError("MoSPI rejected the query: Invalid parameters"));
    const [value] = await refreshIndicators([byId("gdp")], [], NOW);
    expect(value).toEqual({
      id: "gdp",
      label: "GDP growth (real)",
      unit: "%",
      period: null,
      latest: null,
      prevPeriod: null,
      prev: null,
      lastGoodAt: null,
      error: "MoSPI rejected the query: Invalid parameters",
    });
  });

  it("gives a series with one point no previous value", async () => {
    vi.mocked(callTool).mockResolvedValue({ data: [{ year: 2026, month: "July", growth_rate: "6.7" }] });
    const [value] = await refreshIndicators([byId("iip")], [], NOW);
    expect(value).toMatchObject({ period: "Jul 2026", latest: 6.7, prevPeriod: null, prev: null });
  });

  it("takes the label and unit from the current definition, not the previous value", async () => {
    vi.mocked(callTool).mockImplementation(async (name, args) => recordedMospi(name, args));
    const renamed: IndicatorDef = { ...byId("iip"), label: "Industrial output growth" };
    const [value] = await refreshIndicators([renamed], [], NOW);
    expect(value.label).toBe("Industrial output growth");
  });
});
