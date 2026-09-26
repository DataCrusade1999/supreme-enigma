// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toSeries } from "./series";

const rows = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", "mospi", name), "utf8")).data as Record<
    string,
    unknown
  >[];

describe("toSeries", () => {
  it("places calendar months and skips points whose value is null", () => {
    // Base-2024 CPI returns 2025 months with an index but no inflation figure.
    const result = toSeries(rows("cpi-general.json"), "inflation");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points).toHaveLength(8);
    expect(result.points[0]).toEqual({ period: "Jan 2026", value: 2.74 });
    expect(result.points.slice(-2)).toEqual([
      { period: "Jul 2026", value: 4.45 },
      { period: "Aug 2026", value: 4.82 },
    ]);
  });

  it("accepts a numeric year, as IIP sends it", () => {
    const result = toSeries(rows("iip-general.json"), "growth_rate");
    if (!result.ok) throw new Error(result.reason);
    expect(result.points.slice(-2)).toEqual([
      { period: "Jun 2026", value: 8.8 },
      { period: "Jul 2026", value: 6.7 },
    ]);
  });

  it("sorts fiscal quarters that arrive out of order", () => {
    // NAS returns the newest quarter first, then the rest oldest first.
    const result = toSeries(rows("nas-gdp-growth.json"), "constant_price");
    if (!result.ok) throw new Error(result.reason);
    expect(result.points[0]).toEqual({ period: "Q1 2023-24", value: 6.6 });
    expect(result.points.slice(-2)).toEqual([
      { period: "Q4 2025-26", value: 8.6 },
      { period: "Q1 2026-27", value: 7.8 },
    ]);
  });

  it("sorts months from two calendar years that arrive out of order", () => {
    const result = toSeries(rows("plfs-urban-ur.json"), "value");
    if (!result.ok) throw new Error(result.reason);
    expect(result.points[0].period).toBe("Apr 2025");
    expect(result.points.slice(-2)).toEqual([
      { period: "Jul 2026", value: 6.7 },
      { period: "Aug 2026", value: 6.8 },
    ]);
  });

  it("does not place a month inside a fiscal-year label, whose calendar year depends on the dataset", () => {
    // An April–March year and a July–June year both read "2025-26"; guessing
    // would label every point of the wrong kind a year off (#268).
    const result = toSeries([{ year: "2025-26", month: "March", growth_rate: "5.0" }], "growth_rate");
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/cannot place a row in time/) });
  });

  it("places a bare fiscal year", () => {
    const result = toSeries(
      [
        { year: "2024-25", value: "7.1" },
        { year: "2023-24", value: "9.2" },
      ],
      "value",
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.points.map((p) => p.period)).toEqual(["2023-24", "2024-25"]);
  });

  it("is invalid when a row cannot be placed in time", () => {
    // PLFS quarterly labels quarters "Apr-Jun", which has no fixed place in a year.
    const result = toSeries([{ year: "2019", quarter: "Apr-Jun", value: "21.6" }], "value");
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/cannot place a row in time/) });
  });

  it("is invalid when two rows share a period, since the filters match more than one series", () => {
    const result = toSeries(
      [
        { year: "2026", month: "August", inflation: "5.66" },
        { year: "2026", month: "August", inflation: "0.10" },
      ],
      "inflation",
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/two rows for Aug 2026/) });
  });

  it("is invalid when a value is not a number", () => {
    const result = toSeries([{ year: "2026", month: "August", inflation: "n.a." }], "inflation");
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/not a number/) });
  });
});
