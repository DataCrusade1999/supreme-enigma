import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/aws")>()),
  presignUploadTo: vi.fn(async () => "https://signed.example/put"),
}));

import { POST } from "./route";
import { presignUploadTo } from "@/lib/aws";

function post(body: unknown) {
  return new Request("http://localhost/api/resume/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/resume/upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
  });

  it("returns a draft id and a signed URL", async () => {
    const res = await POST(post({ contentType: "application/pdf", size: 1024 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draftId).toMatch(/^[a-f0-9-]{36}$/);
    expect(body.uploadUrl).toBe("https://signed.example/put");
  });

  it("signs against the resume bucket and a drafts key", async () => {
    await POST(post({ contentType: "application/pdf", size: 1024 }));
    const [bucket, key, contentType, length] = vi.mocked(presignUploadTo).mock.calls[0];
    expect(bucket).toBe("resume-bucket");
    expect(key).toMatch(/^resume\/drafts\/[a-f0-9-]{36}\/resume\.pdf$/);
    expect(contentType).toBe("application/pdf");
    expect(length).toBe(1024);
  });

  it("rejects a non-PDF", async () => {
    // The extraction plugin is configured for PDF; anything else wastes a
    // model call and stores a file nothing can read.
    const res = await POST(post({ contentType: "image/png", size: 1024 }));
    expect(res.status).toBe(415);
    expect(presignUploadTo).not.toHaveBeenCalled();
  });

  it("rejects a file over the 5 MB cap", async () => {
    const res = await POST(post({ contentType: "application/pdf", size: 6 * 1024 * 1024 }));
    expect(res.status).toBe(413);
    expect(presignUploadTo).not.toHaveBeenCalled();
  });

  it("rejects a missing or nonsensical size", async () => {
    expect((await POST(post({ contentType: "application/pdf" }))).status).toBe(400);
    expect((await POST(post({ contentType: "application/pdf", size: 0 }))).status).toBe(400);
    expect((await POST(post({ contentType: "application/pdf", size: -1 }))).status).toBe(400);
  });
});
