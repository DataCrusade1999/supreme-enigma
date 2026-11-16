// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./feeds", () => ({ fetchAllFeeds: vi.fn() }));
vi.mock("./tagger", () => ({ tagHeadlines: vi.fn() }));
vi.mock("./indicators", () => ({ refreshIndicators: vi.fn() }));
vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return { ...actual, readSnapshot: vi.fn(), readIndicatorDefs: vi.fn(), writeSnapshot: vi.fn() };
});

import { DEFAULT_INDICATORS } from "./defaults";
import { fetchAllFeeds } from "./feeds";
import { withId } from "./dedupe";
import { refreshIndicators } from "./indicators";
import { readIndicatorDefs, readSnapshot, SnapshotCorruptError, writeSnapshot } from "./store";
import { MAX_TAG_ATTEMPTS, runRefresh } from "./refresh";
import { tagHeadlines } from "./tagger";
import type { IndicatorValue, Snapshot } from "./types";

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
    vi.mocked(tagHeadlines).mockResolvedValue({ tags: new Map(), answered: new Set(), calls: 0, failedCalls: 0, costUsd: 0 });
    vi.mocked(readIndicatorDefs).mockResolvedValue(DEFAULT_INDICATORS);
    vi.mocked(refreshIndicators).mockResolvedValue([]);
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
      answered: new Set([fresh.id]),
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

  it("counts a miss and stops sending an item after MAX_TAG_ATTEMPTS (#263)", async () => {
    const missedTwice = { ...withId({ title: "Missed twice", url: "https://ft.example/m2", source: "FT", publishedAt: "2026-09-24T11:00:00.000Z", direct: true }), tagAttempts: 2 };
    const givenUp = { ...withId({ title: "Given up", url: "https://ft.example/gu", source: "FT", publishedAt: "2026-09-24T11:30:00.000Z", direct: true }), tagAttempts: MAX_TAG_ATTEMPTS };
    vi.mocked(readSnapshot).mockResolvedValue({ version: 1, refreshedAt: "2026-09-24T12:00:00.000Z", headlines: [missedTwice, givenUp], indicators: [], sourceErrors: [] });
    vi.mocked(tagHeadlines).mockResolvedValue({ tags: new Map([[fresh.id, "Economy"]]), answered: new Set([fresh.id, missedTwice.id]), calls: 1, failedCalls: 0, costUsd: 0.001 });

    const result = await runRefresh(NOW);

    const sent = vi.mocked(tagHeadlines).mock.calls[0][0].map((h) => h.id).sort();
    expect(sent).toEqual([fresh.id, missedTwice.id].sort());
    const byId = new Map(result.headlines.map((h) => [h.id, h]));
    expect(byId.get(missedTwice.id)).toMatchObject({ tag: "Untagged", tagAttempts: 3 });
    expect(byId.get(givenUp.id)).toMatchObject({ tag: "Untagged", tagAttempts: MAX_TAG_ATTEMPTS });
    expect(byId.get(fresh.id)?.tagAttempts).toBeUndefined();
  });

  it("does not count an attempt when the call failed, so an outage keeps the item (#263)", async () => {
    const missedTwice = { ...withId({ title: "Missed twice", url: "https://ft.example/m2", source: "FT", publishedAt: "2026-09-24T11:00:00.000Z", direct: true }), tagAttempts: 2 };
    vi.mocked(readSnapshot).mockResolvedValue({ version: 1, refreshedAt: "2026-09-24T12:00:00.000Z", headlines: [missedTwice], indicators: [], sourceErrors: [] });
    vi.mocked(tagHeadlines).mockResolvedValue({ tags: new Map(), answered: new Set(), calls: 1, failedCalls: 1, costUsd: 0 });
    const result = await runRefresh(NOW);
    expect(result.headlines.find((h) => h.id === missedTwice.id)?.tagAttempts).toBe(2);
  });

  it("does not count an attempt when no tagging call was made", async () => {
    vi.mocked(readSnapshot).mockResolvedValue(null);
    const result = await runRefresh(NOW);
    expect(result.headlines[0].tagAttempts).toBeUndefined();
  });

  it("retries a failed snapshot write so paid-for tags are kept (#263)", async () => {
    vi.mocked(readSnapshot).mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(writeSnapshot).mockRejectedValueOnce(new Error("s3 503"));
    const result = await runRefresh(NOW);
    expect(writeSnapshot).toHaveBeenCalledTimes(2);
    expect(writeSnapshot).toHaveBeenLastCalledWith(result);
  });

  it("gives up on the write after its retries", async () => {
    vi.mocked(readSnapshot).mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Once per attempt: clearAllMocks keeps a standing implementation for the next test.
    for (let i = 0; i < 3; i++) vi.mocked(writeSnapshot).mockRejectedValueOnce(new Error("s3 503"));
    await expect(runRefresh(NOW)).rejects.toThrow("s3 503");
    expect(writeSnapshot).toHaveBeenCalledTimes(3);
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

  it("saves refreshed indicators, passing the previous values in", async () => {
    const before: IndicatorValue = {
      id: "iip",
      label: "IIP growth",
      unit: "%",
      period: "Jun 2026",
      latest: 8.8,
      prevPeriod: "May 2026",
      prev: 5,
      lastGoodAt: "2026-09-20T08:00:00.000Z",
    };
    const after: IndicatorValue = { ...before, period: "Jul 2026", latest: 6.7, prevPeriod: "Jun 2026", prev: 8.8 };
    vi.mocked(readSnapshot).mockResolvedValue({
      version: 1,
      refreshedAt: "2026-09-24T12:00:00.000Z",
      headlines: [],
      indicators: [before],
      sourceErrors: [],
    });
    vi.mocked(refreshIndicators).mockResolvedValue([after]);

    const result = await runRefresh(NOW);

    expect(refreshIndicators).toHaveBeenCalledWith(DEFAULT_INDICATORS, [before], NOW);
    expect(result.indicators).toEqual([after]);
    expect(writeSnapshot).toHaveBeenCalledWith(result);
  });

  it("starts the indicators without waiting for the feeds", async () => {
    let releaseFeeds!: () => void;
    vi.mocked(fetchAllFeeds).mockReturnValue(
      new Promise((resolve) => (releaseFeeds = () => resolve({ headlines: [fresh], errors: [] }))),
    );
    vi.mocked(readSnapshot).mockResolvedValue(null);

    const done = runRefresh(NOW);
    await vi.waitFor(() => expect(refreshIndicators).toHaveBeenCalled());
    releaseFeeds();
    await done;
  });

  it("reads the snapshot and the indicator definitions at the same time", async () => {
    let releaseSnapshot!: () => void;
    vi.mocked(readSnapshot).mockReturnValue(new Promise((resolve) => (releaseSnapshot = () => resolve(null))));

    const done = runRefresh(NOW);
    await vi.waitFor(() => expect(readIndicatorDefs).toHaveBeenCalled());
    releaseSnapshot();
    await done;
  });

  it("still saves headlines when the indicator definitions cannot be read", async () => {
    vi.mocked(readSnapshot).mockResolvedValue(null);
    vi.mocked(readIndicatorDefs).mockRejectedValue(
      Object.assign(new Error("Access Denied"), { name: "AccessDenied" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runRefresh(NOW);

    expect(refreshIndicators).toHaveBeenCalledWith(DEFAULT_INDICATORS, [], NOW);
    expect(result.headlines.map((h) => h.id)).toEqual([fresh.id]);
    expect(result.sourceErrors).toContainEqual({
      source: "indicators.json",
      message: "unreadable, used the defaults: Access Denied",
    });
    expect(writeSnapshot).toHaveBeenCalledWith(result);
  });

  it("keeps other indicators, marked stale, when it falls back to the defaults", async () => {
    const pinned: IndicatorValue = {
      id: "user-pin",
      label: "Pinned",
      unit: "%",
      period: "Jun 2026",
      latest: 1.5,
      prevPeriod: "May 2026",
      prev: 1.4,
      lastGoodAt: "2026-09-20T08:00:00.000Z",
    };
    vi.mocked(readSnapshot).mockResolvedValue({
      version: 1,
      refreshedAt: "2026-09-24T12:00:00.000Z",
      headlines: [],
      indicators: [pinned],
      sourceErrors: [],
    });
    vi.mocked(readIndicatorDefs).mockRejectedValue(new Error("Access Denied"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runRefresh(NOW);

    expect(result.indicators).toContainEqual({
      ...pinned,
      error: "indicators.json unreadable, used the defaults: Access Denied",
    });
  });
});
