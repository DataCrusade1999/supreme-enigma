// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  getObjectBytes: vi.fn(),
  putObjectJson: vi.fn(),
}));

import { getObjectBytes, putObjectJson } from "@/lib/aws";
import {
  isStorageConfigured,
  readSnapshot,
  SNAPSHOT_KEY,
  SnapshotCorruptError,
  writeSnapshot,
} from "./store";
import type { Snapshot } from "./types";

const SNAPSHOT: Snapshot = {
  version: 1,
  refreshedAt: "2026-09-25T12:00:00.000Z",
  headlines: [],
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
});
