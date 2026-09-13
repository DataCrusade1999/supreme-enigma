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
    expect(calls[2]).toEqual(["resume/drafts/abc/resume.pdf", "resume/current.pdf"]);
    expect(calls[3]).toEqual(["resume/drafts/abc/resume.json", "resume/current.json"]);
  });

  it("publishes with nothing to archive on the first publish", async () => {
    // This is a normal path, not an error — it is the state of production on
    // the day this ships.
    vi.mocked(objectExists).mockResolvedValue(false);

    const res = await POST(post({ draftId: "abc" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: false });
    const calls = vi.mocked(copyObject).mock.calls.map(([, from, to]) => [from, to]);
    expect(calls).toEqual([
      ["resume/drafts/abc/resume.pdf", "resume/current.pdf"],
      ["resume/drafts/abc/resume.json", "resume/current.json"],
    ]);
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
