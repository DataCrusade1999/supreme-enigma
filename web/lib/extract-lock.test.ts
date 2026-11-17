import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./aws", () => ({ getObjectText: vi.fn(), putObjectConditional: vi.fn() }));

import { getObjectText, putObjectConditional } from "./aws";
import { claimExtraction, LOCK_TTL_MS, releaseExtraction } from "./extract-lock";

// An in-memory bucket with S3's conditional-write semantics, so two claims can
// race the way two route instances would.
function fakeBucket() {
  const objects = new Map<string, { text: string; etag: string }>();
  let n = 0;
  vi.mocked(putObjectConditional).mockImplementation(async (_b, key, body, ifMatch) => {
    const existing = objects.get(key);
    if (ifMatch === undefined ? existing : existing?.etag !== ifMatch) return null;
    const etag = `"e${++n}"`;
    objects.set(key, { text: body, etag });
    return etag;
  });
  vi.mocked(getObjectText).mockImplementation(async (_b, key) => objects.get(key) ?? null);
  return objects;
}

const KEY = "resume/drafts/abc/extract.lock";

describe("claimExtraction", () => {
  beforeEach(() => vi.resetAllMocks());

  it("lets exactly one of two concurrent claims win", async () => {
    fakeBucket();
    const results = await Promise.all([claimExtraction("b", KEY), claimExtraction("b", KEY)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("refuses a lock another caller holds", async () => {
    fakeBucket();
    expect(await claimExtraction("b", KEY, 1_000)).not.toBeNull();
    expect(await claimExtraction("b", KEY, 2_000)).toBeNull();
  });

  it("takes a released lock", async () => {
    fakeBucket();
    const token = await claimExtraction("b", KEY);
    await releaseExtraction("b", KEY, token!);
    expect(await claimExtraction("b", KEY)).not.toBeNull();
  });

  it("takes over a lock older than the TTL", async () => {
    fakeBucket();
    await claimExtraction("b", KEY, 1_000);
    expect(await claimExtraction("b", KEY, 1_000 + LOCK_TTL_MS)).not.toBeNull();
  });

  it("lets only one caller take over the same released lock", async () => {
    fakeBucket();
    const token = await claimExtraction("b", KEY);
    await releaseExtraction("b", KEY, token!);
    const results = await Promise.all([claimExtraction("b", KEY), claimExtraction("b", KEY)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("does not release a lock someone else has since taken over", async () => {
    const objects = fakeBucket();
    const stale = await claimExtraction("b", KEY, 1_000);
    await claimExtraction("b", KEY, 1_000 + LOCK_TTL_MS);
    await releaseExtraction("b", KEY, stale!);
    expect(JSON.parse(objects.get(KEY)!.text)).toEqual({ claimedAt: 1_000 + LOCK_TTL_MS });
  });

  it("never throws from release", async () => {
    vi.mocked(putObjectConditional).mockRejectedValue(new Error("s3 503"));
    await expect(releaseExtraction("b", KEY, '"e1"')).resolves.toBeUndefined();
  });
});
