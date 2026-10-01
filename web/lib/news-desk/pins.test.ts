// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return { ...actual, readPins: vi.fn(), writePins: vi.fn(), readSnapshot: vi.fn(), writeSnapshot: vi.fn() };
});

import { PinError, pinId, pinIndicator, unpinIndicator } from "./pins";
import { readPins, readSnapshot, SnapshotCorruptError, writePins, writeSnapshot } from "./store";
import type { Snapshot } from "./types";

const INPUT = {
  label: "IIP manufacturing",
  dataset: "IIP",
  filters: { base_year: "2022-23", frequency: "Monthly", type: "Sectoral", category_code: "2" },
  valueField: "growth_rate",
  unit: "%",
};
const SNAPSHOT: Snapshot = { version: 1, refreshedAt: "2026-09-26T10:00:00.000Z", headlines: [], indicators: [], sourceErrors: [] };

describe("pinId", () => {
  it("is the same for the same query whatever the filter order", () => {
    const reordered = { ...INPUT, filters: Object.fromEntries(Object.entries(INPUT.filters).reverse()) };
    expect(pinId(INPUT)).toBe(pinId(reordered));
    expect(pinId(INPUT)).toMatch(/^pin-[0-9a-f]{12}$/);
  });

  it("differs when the query differs", () => {
    expect(pinId(INPUT)).not.toBe(pinId({ ...INPUT, valueField: "index" }));
  });
});

describe("pinIndicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readPins).mockResolvedValue([]);
    vi.mocked(readSnapshot).mockResolvedValue(SNAPSHOT);
  });

  it("stores the pin and adds an empty row to the saved table", async () => {
    const row = await pinIndicator(INPUT);
    const id = pinId(INPUT);
    expect(writePins).toHaveBeenCalledWith([{ id, ...INPUT }]);
    expect(row).toEqual({ id, label: INPUT.label, unit: "%", period: null, latest: null, prevPeriod: null, prev: null, lastGoodAt: null });
    expect(writeSnapshot).toHaveBeenCalledWith({ ...SNAPSHOT, indicators: [row] });
  });

  it("refuses the same chart twice", async () => {
    vi.mocked(readPins).mockResolvedValue([{ id: pinId(INPUT), ...INPUT }]);
    await expect(pinIndicator(INPUT)).rejects.toEqual(new PinError("already pinned", 409));
    expect(writePins).not.toHaveBeenCalled();
  });

  it("writes nothing when the stored pins cannot be read", async () => {
    vi.mocked(readPins).mockRejectedValue(new Error("Access Denied"));
    await expect(pinIndicator(INPUT)).rejects.toThrow("Access Denied");
    expect(writePins).not.toHaveBeenCalled();
    expect(writeSnapshot).not.toHaveBeenCalled();
  });

  it("stores the pin even when there is no usable snapshot yet", async () => {
    vi.mocked(readSnapshot).mockRejectedValue(new SnapshotCorruptError("bad"));
    await pinIndicator(INPUT);
    expect(writePins).toHaveBeenCalled();
    expect(writeSnapshot).not.toHaveBeenCalled();
  });
});

describe("unpinIndicator", () => {
  const id = pinId(INPUT);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readPins).mockResolvedValue([{ id, ...INPUT }]);
    vi.mocked(readSnapshot).mockResolvedValue({
      ...SNAPSHOT,
      indicators: [{ id, label: "IIP manufacturing", unit: "%", period: null, latest: null, prevPeriod: null, prev: null, lastGoodAt: null }],
    });
  });

  it("removes the pin and its row", async () => {
    await unpinIndicator(id);
    expect(writePins).toHaveBeenCalledWith([]);
    expect(writeSnapshot).toHaveBeenCalledWith(SNAPSHOT);
  });

  it("refuses to remove a default indicator", async () => {
    await expect(unpinIndicator("cpi-headline")).rejects.toEqual(new PinError("default indicators cannot be removed", 400));
  });

  it("says when the id is not pinned", async () => {
    await expect(unpinIndicator("pin-000000000000")).rejects.toEqual(new PinError("not pinned", 404));
  });
});
