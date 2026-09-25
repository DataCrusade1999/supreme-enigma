// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./feeds", () => ({ fetchAllFeeds: vi.fn() }));
vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return { ...actual, readSnapshot: vi.fn(), writeSnapshot: vi.fn() };
});

import { fetchAllFeeds } from "./feeds";
import { withId } from "./dedupe";
import { readSnapshot, SnapshotCorruptError, writeSnapshot } from "./store";
import { runRefresh } from "./refresh";
import type { Snapshot } from "./types";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const fresh = withId({
  title: "New story",
  url: "https://ft.example/new",
  source: "FT",
  publishedAt: "2026-09-25T10:00:00.000Z",
  direct: true,
});
const stored = withId({
  title: "Stored story",
  url: "https://ft.example/stored",
  source: "FT",
  publishedAt: "2026-09-24T10:00:00.000Z",
  direct: true,
});

describe("runRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAllFeeds).mockResolvedValue({
      headlines: [fresh],
      errors: [{ source: "SEBI", message: "timed out" }],
    });
  });

  it("merges new headlines into the stored ones and saves the result", async () => {
    const previous: Snapshot = {
      version: 1,
      refreshedAt: "2026-09-24T12:00:00.000Z",
      headlines: [stored],
      sourceErrors: [],
    };
    vi.mocked(readSnapshot).mockResolvedValue(previous);

    const result = await runRefresh(NOW);

    expect(result).toEqual({
      version: 1,
      refreshedAt: "2026-09-25T12:00:00.000Z",
      headlines: [fresh, stored],
      sourceErrors: [{ source: "SEBI", message: "timed out" }],
    });
    expect(writeSnapshot).toHaveBeenCalledWith(result);
  });

  it("starts from nothing on the first refresh", async () => {
    vi.mocked(readSnapshot).mockResolvedValue(null);
    const result = await runRefresh(NOW);
    expect(result.headlines).toEqual([fresh]);
  });

  it("replaces a corrupt snapshot instead of failing forever", async () => {
    vi.mocked(readSnapshot).mockRejectedValue(new SnapshotCorruptError("bad"));
    const result = await runRefresh(NOW);
    expect(result.headlines).toEqual([fresh]);
    expect(writeSnapshot).toHaveBeenCalled();
  });

  it("does not overwrite the snapshot when S3 itself fails", async () => {
    vi.mocked(readSnapshot).mockRejectedValue(
      Object.assign(new Error("AccessDenied"), { name: "AccessDenied" }),
    );
    await expect(runRefresh(NOW)).rejects.toThrow("AccessDenied");
    expect(writeSnapshot).not.toHaveBeenCalled();
  });
});
