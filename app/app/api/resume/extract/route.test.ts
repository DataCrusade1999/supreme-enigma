import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  getObjectBytes: vi.fn(),
  putObjectJson: vi.fn(),
  objectExists: vi.fn(),
}));
vi.mock("@/lib/openrouter", () => ({ extractResumeFromPdf: vi.fn() }));

import { POST } from "./route";
import { getObjectBytes, putObjectJson, objectExists } from "@/lib/aws";
import { extractResumeFromPdf } from "@/lib/openrouter";

const VALID = {
  headline: { name: "A", title: "B", summary: "C" },
  work: [{ role: "R", org: "O", start: "2025", end: "Present", bullets: ["did a thing"] }],
  skills: [{ group: "Languages", items: ["TypeScript"] }],
};

function post(body: unknown) {
  return new Request("http://localhost/api/resume/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/resume/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
    // Default world: the PDF has been uploaded, no extraction has run yet.
    // The route asks about both keys, so the mock must distinguish them.
    vi.mocked(objectExists).mockImplementation(async (_bucket, key) =>
      key.endsWith("resume.pdf"),
    );
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from("%PDF"));
    vi.mocked(extractResumeFromPdf).mockResolvedValue(VALID);
  });

  it("extracts, validates, and writes the draft JSON", async () => {
    const res = await POST(post({ draftId: "abc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ draftId: "abc", resume: VALID });

    const [bucket, key, body] = vi.mocked(putObjectJson).mock.calls[0];
    expect(bucket).toBe("resume-bucket");
    expect(key).toBe("resume/drafts/abc/resume.json");
    expect(body).toEqual(VALID);
  });

  it("is idempotent — an existing draft JSON short-circuits the model call", async () => {
    // A refresh loop must not be able to generate repeated paid model calls.
    // See the design spec §9.1.
    vi.mocked(objectExists).mockResolvedValue(true); // both keys present
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(VALID)));

    const res = await POST(post({ draftId: "abc" }));

    expect(res.status).toBe(200);
    expect(extractResumeFromPdf).not.toHaveBeenCalled();
    expect(putObjectJson).not.toHaveBeenCalled();
  });

  it("re-extracts when force is set", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    await POST(post({ draftId: "abc", force: true }));
    expect(extractResumeFromPdf).toHaveBeenCalledTimes(1);
  });

  it("does not write to S3 when the model call fails", async () => {
    vi.mocked(extractResumeFromPdf).mockRejectedValue(new Error("upstream exploded"));
    const res = await POST(post({ draftId: "abc" }));
    expect(res.status).toBe(502);
    expect(putObjectJson).not.toHaveBeenCalled();
  });

  it("does not write JSON that is valid JSON but fails the schema", async () => {
    vi.mocked(extractResumeFromPdf).mockResolvedValue({ headline: { name: "only" } });
    const res = await POST(post({ draftId: "abc" }));

    expect(res.status).toBe(422);
    expect(putObjectJson).not.toHaveBeenCalled();
    // The raw response comes back so the review UI can show what arrived
    // rather than just reporting a failure.
    expect(await res.json()).toHaveProperty("raw");
  });

  it("rejects a draft id that could escape the prefix", async () => {
    const res = await POST(post({ draftId: "../current" }));
    expect(res.status).toBe(400);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("404s for a well-formed draft id whose PDF was never uploaded", async () => {
    // Spec §5.3 step 1: confirm the object exists before doing anything else.
    // Without this, a stale draft id from a bookmarked admin page reaches
    // getObjectBytes and surfaces as an unhandled 500.
    vi.mocked(objectExists).mockResolvedValue(false); // neither key present

    const res = await POST(post({ draftId: "never-uploaded" }));

    expect(res.status).toBe(404);
    expect(extractResumeFromPdf).not.toHaveBeenCalled();
  });
});
