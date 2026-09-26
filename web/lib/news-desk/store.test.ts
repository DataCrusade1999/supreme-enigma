// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  getObjectBytes: vi.fn(),
  putObjectJson: vi.fn(),
}));

import { getObjectBytes, putObjectJson } from "@/lib/aws";
import { DEFAULT_INDICATORS } from "./defaults";
import {
  INDICATORS_KEY,
  isStorageConfigured,
  readIndicatorDefs,
  readPins,
  readSnapshot,
  SNAPSHOT_KEY,
  SnapshotCorruptError,
  writePins,
  writeSnapshot,
} from "./store";
import type { Snapshot } from "./types";

const SNAPSHOT: Snapshot = {
  version: 1,
  refreshedAt: "2026-09-25T12:00:00.000Z",
  headlines: [],
  indicators: [],
  sourceErrors: [],
};

describe("news-desk store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = "audio-bucket";
  });

  it("reads and validates the snapshot from the branch bucket", async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(SNAPSHOT)));
    expect(await readSnapshot()).toEqual(SNAPSHOT);
    expect(getObjectBytes).toHaveBeenCalledWith("audio-bucket", SNAPSHOT_KEY);
  });

  it("returns null before the first refresh has written anything", async () => {
    vi.mocked(getObjectBytes).mockRejectedValue(
      Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" }),
    );
    expect(await readSnapshot()).toBeNull();
  });

  it("does not report a permissions failure as 'nothing saved yet'", async () => {
    vi.mocked(getObjectBytes).mockRejectedValue(
      Object.assign(new Error("AccessDenied"), { name: "AccessDenied" }),
    );
    await expect(readSnapshot()).rejects.toThrow("AccessDenied");
  });

  it("flags a snapshot that is not JSON as corrupt", async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from("not json"));
    await expect(readSnapshot()).rejects.toBeInstanceOf(SnapshotCorruptError);
  });

  it("flags a snapshot of the wrong shape as corrupt", async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify({ version: 2 })));
    await expect(readSnapshot()).rejects.toBeInstanceOf(SnapshotCorruptError);
  });

  it("writes the whole snapshot to the same key", async () => {
    await writeSnapshot(SNAPSHOT);
    expect(putObjectJson).toHaveBeenCalledWith("audio-bucket", SNAPSHOT_KEY, SNAPSHOT);
  });

  it("knows when no bucket is configured", () => {
    delete process.env.S3_BUCKET_NAME;
    expect(isStorageConfigured()).toBe(false);
  });
  it("reads a Phase 1 snapshot, whose headlines have no tag, as Untagged", async () => {
    const phase1 = {
      version: 1,
      refreshedAt: "2026-09-25T12:00:00.000Z",
      headlines: [
        {
          id: "a",
          title: "Old story",
          url: "https://ft.example/a",
          source: "FT",
          publishedAt: "2026-09-25T10:00:00.000Z",
          direct: true,
        },
      ],
      sourceErrors: [],
    };
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(phase1)));
    const snapshot = await readSnapshot();
    expect(snapshot?.headlines[0].tag).toBe("Untagged");
  });

  it("reads a Phase 2 snapshot, which has no indicators, with an empty list", async () => {
    const phase2 = {
      version: 1,
      refreshedAt: "2026-09-26T09:00:00.000Z",
      headlines: [],
      sourceErrors: [],
    };
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(phase2)));
    expect((await readSnapshot())?.indicators).toEqual([]);
  });

  it("uses the default indicators when none are stored", async () => {
    vi.mocked(getObjectBytes).mockRejectedValue(Object.assign(new Error("gone"), { name: "NoSuchKey" }));
    expect(await readIndicatorDefs()).toEqual(DEFAULT_INDICATORS);
    expect(vi.mocked(getObjectBytes)).toHaveBeenCalledWith("audio-bucket", INDICATORS_KEY);
  });

  it("lists the defaults, then the stored pins", async () => {
    const pin = { id: "pin-abc", label: "X", dataset: "IIP", filters: { type: "General" }, valueField: "growth_rate", unit: "%" };
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify([pin])));
    expect(await readIndicatorDefs()).toEqual([...DEFAULT_INDICATORS, pin]);
  });

  it("does not let a stored entry replace or repeat a default", async () => {
    const clash = { ...DEFAULT_INDICATORS[0], label: "Changed" };
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify([clash])));
    expect(await readIndicatorDefs()).toEqual(DEFAULT_INDICATORS);
  });

  it("reads no pins when none are stored", async () => {
    vi.mocked(getObjectBytes).mockRejectedValue(Object.assign(new Error("gone"), { name: "NoSuchKey" }));
    expect(await readPins()).toEqual([]);
  });

  it("writes the pins as the whole indicators file", async () => {
    const pin = { id: "pin-abc", label: "X", dataset: "IIP", filters: {}, valueField: "growth_rate", unit: "%" };
    await writePins([pin]);
    expect(putObjectJson).toHaveBeenCalledWith("audio-bucket", INDICATORS_KEY, [pin]);
  });

  it("surfaces an S3 failure reading indicator definitions", async () => {
    vi.mocked(getObjectBytes).mockRejectedValue(Object.assign(new Error("denied"), { name: "AccessDenied" }));
    await expect(readIndicatorDefs()).rejects.toThrow("denied");
  });
});
