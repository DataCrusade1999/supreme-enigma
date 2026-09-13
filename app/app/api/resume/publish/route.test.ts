import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({ copyObject: vi.fn(), objectExists: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { POST } from "./route";
import { copyObject, objectExists } from "@/lib/aws";
import { revalidateTag } from "next/cache";

function post(body: unknown) {
  return new Request("http://localhost/api/resume/publish", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/resume/publish", () => {
  const originalEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
    process.env.VERCEL_ENV = "production";
    vi.mocked(objectExists).mockResolvedValue(true);
  });

  // The draft keys are checked before anything is overwritten, so a test that
  // wants "nothing to archive" has to answer per key rather than blanket-false.
  function existsExcept(...absent: string[]) {
    vi.mocked(objectExists).mockImplementation(async (_bucket, key) =>
      !absent.includes(key),
    );
  }

  afterEach(() => {
    process.env.VERCEL_ENV = originalEnv;
  });

  it("refuses to publish outside production", async () => {
    // Drafts stay writable everywhere so a draft reviewed on dev can be
    // published from production — only publishing is production-only.
    // See the design spec §7.3.
    process.env.VERCEL_ENV = "preview";
    const res = await POST(post({ draftId: "abc" }));
    expect(res.status).toBe(403);
    expect(copyObject).not.toHaveBeenCalled();
  });

  it("archives the existing pair, then promotes the draft", async () => {
    const res = await POST(post({ draftId: "abc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: true });

    const calls = vi.mocked(copyObject).mock.calls.map(([, from, to]) => [from, to]);
    // Archive first, promote second — the other order would overwrite the
    // live pair before it had been copied anywhere.
    expect(calls[0][0]).toBe("resume/current.pdf");
    expect(calls[0][1]).toMatch(/^resume\/archive\/.*\.pdf$/);
    expect(calls[1][0]).toBe("resume/current.json");
    expect(calls[1][1]).toMatch(/^resume\/archive\/.*\.json$/);
    expect(calls[2]).toEqual(["resume/drafts/abc/resume.json", "resume/current.json"]);
    expect(calls[3]).toEqual(["resume/drafts/abc/resume.pdf", "resume/current.pdf"]);
  });

  it("writes every object into the resume bucket, not the audio bucket", async () => {
    // This is the only route that overwrites the live resume. Without this the
    // suite stays green if resumeBucket() is ever swapped for S3_BUCKET_NAME,
    // which would publish into the per-branch audio bucket.
    process.env.S3_BUCKET_NAME = "audio-bucket";

    await POST(post({ draftId: "abc" }));

    const buckets = vi.mocked(copyObject).mock.calls.map(([bucket]) => bucket);
    expect(buckets.length).toBeGreaterThan(0);
    expect(new Set(buckets)).toEqual(new Set(["resume-bucket"]));
    for (const [bucket] of vi.mocked(objectExists).mock.calls) {
      expect(bucket).toBe("resume-bucket");
    }
  });

  it("publishes with nothing to archive on the first publish", async () => {
    // This is a normal path, not an error — it is the state of production on
    // the day this ships.
    existsExcept("resume/current.json");

    const res = await POST(post({ draftId: "abc" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: false });
    const calls = vi.mocked(copyObject).mock.calls.map(([, from, to]) => [from, to]);
    expect(calls).toEqual([
      ["resume/drafts/abc/resume.json", "resume/current.json"],
      ["resume/drafts/abc/resume.pdf", "resume/current.pdf"],
    ]);
  });

  it("refuses a draft whose JSON has expired rather than promoting half of it", async () => {
    // `resume/drafts/` expires after a day and the two objects do not go at the
    // same instant, so a day-old draft can still have its PDF. Promoting it
    // would leave current.pdf and current.json describing different resumes.
    existsExcept("resume/drafts/abc/resume.json");

    const res = await POST(post({ draftId: "abc" }));

    expect(res.status).toBe(404);
    expect(copyObject).not.toHaveBeenCalled();
  });

  it("refuses a draft that was never extracted", async () => {
    existsExcept("resume/drafts/abc/resume.pdf");

    const res = await POST(post({ draftId: "abc" }));

    expect(res.status).toBe(404);
    expect(copyObject).not.toHaveBeenCalled();
  });

  it("revalidates the resume cache tag so the public pages update", async () => {
    await POST(post({ draftId: "abc" }));
    expect(revalidateTag).toHaveBeenCalledWith("resume", { expire: 0 });
  });

  it("rejects an unsafe draft id", async () => {
    const res = await POST(post({ draftId: "../current" }));
    expect(res.status).toBe(400);
    expect(copyObject).not.toHaveBeenCalled();
  });
});
