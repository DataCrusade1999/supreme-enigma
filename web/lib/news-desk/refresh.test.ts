// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./feeds", () => ({ fetchAllFeeds: vi.fn() }));
vi.mock("./tagger", () => ({ tagHeadlines: vi.fn() }));
vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return { ...actual, readSnapshot: vi.fn(), writeSnapshot: vi.fn() };
});

import { fetchAllFeeds } from "./feeds";
import { withId } from "./dedupe";
import { readSnapshot, SnapshotCorruptError, writeSnapshot } from "./store";
import { runRefresh } from "./refresh";
import { tagHeadlines } from "./tagger";
import type { Snapshot } from "./types";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const fresh = withId({
  title: "New story",
  url: "https://ft.example/new",
  source: "FT",
  publishedAt: "2026-09-25T10:00:00.000Z",
  direct: true,
});
const stored = {
  ...withId({
    title: "Stored story",
    url: "https://ft.example/stored",
    source: "FT",
    publishedAt: "2026-09-24T10:00:00.000Z",
    direct: true,
  }),
  tag: "Economy" as const,
};

describe("runRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAllFeeds).mockResolvedValue({
      headlines: [fresh],
      errors: [{ source: "SEBI", message: "timed out" }],
    });
    vi.mocked(tagHeadlines).mockResolvedValue({ tags: new Map(), calls: 0, failedCalls: 0, costUsd: 0 });
  });

  it("merges new headlines into the stored ones and saves the result", async () => {
    const previous: Snapshot = {
      version: 1,
      refreshedAt: "2026-09-24T12:00:00.000Z",
      headlines: [stored],
      indicators: [],
      sourceErrors: [],
    };
    vi.mocked(readSnapshot).mockResolvedValue(previous);

    const result = await runRefresh(NOW);

    expect(result).toEqual({
      version: 1,
      refreshedAt: "2026-09-25T12:00:00.000Z",
      headlines: [fresh, stored],
      indicators: [],
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

  it("sends only untagged headlines to the tagger and saves the tags it returns", async () => {
    // Built field by field: spreading `fresh` into withId would carry fresh's id over the new one.
    const failedBefore = withId({
      title: "Failed last time",
      url: "https://ft.example/failed",
      source: "FT",
      publishedAt: "2026-09-24T11:00:00.000Z",
      direct: true,
    });
    vi.mocked(readSnapshot).mockResolvedValue({
      version: 1,
      refreshedAt: "2026-09-24T12:00:00.000Z",
      headlines: [stored, failedBefore],
      indicators: [],
      sourceErrors: [],
    });
    vi.mocked(tagHeadlines).mockResolvedValue({
      tags: new Map([[fresh.id, "Reforms"]]),
      calls: 1,
      failedCalls: 0,
      costUsd: 0.001,
    });

    const result = await runRefresh(NOW);

    const sent = vi.mocked(tagHeadlines).mock.calls[0][0].map((h) => h.id).sort();
    expect(sent).toEqual([fresh.id, failedBefore.id].sort());
    const byId = new Map(result.headlines.map((h) => [h.id, h.tag]));
    expect(byId.get(fresh.id)).toBe("Reforms");
    expect(byId.get(failedBefore.id)).toBe("Untagged");
    expect(byId.get(stored.id)).toBe("Economy");
    expect(writeSnapshot).toHaveBeenCalledWith(result);
  });

  it("does not send dropped headlines again", async () => {
    const dropped = { ...stored, id: "dropped", title: "Athlete congratulated", tag: "Drop" as const };
    vi.mocked(readSnapshot).mockResolvedValue({
      version: 1,
      refreshedAt: "2026-09-24T12:00:00.000Z",
      headlines: [dropped],
      indicators: [],
      sourceErrors: [],
    });
    await runRefresh(NOW);
    const sent = vi.mocked(tagHeadlines).mock.calls[0][0].map((h) => h.id);
    expect(sent).toEqual([fresh.id]);
  });
});
