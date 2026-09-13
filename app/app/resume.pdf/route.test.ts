import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  objectExists: vi.fn(),
  presignDownloadFrom: vi.fn(),
}));

import { GET } from "./route";
import { objectExists, presignDownloadFrom } from "@/lib/aws";

describe("GET /resume.pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("redirects to a presigned URL when a resume is published", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(presignDownloadFrom).mockResolvedValue("https://signed.example/get");

    const res = await GET();

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://signed.example/get");
    expect(vi.mocked(presignDownloadFrom).mock.calls[0]).toEqual([
      "resume-bucket",
      "resume/current.pdf",
      'attachment; filename="ashutosh-pandey-resume.pdf"',
    ]);
  });

  it("404s before the first publish instead of redirecting nowhere", async () => {
    vi.mocked(objectExists).mockResolvedValue(false);

    const res = await GET();

    expect(res.status).toBe(404);
    expect(presignDownloadFrom).not.toHaveBeenCalled();
  });

  it("404s rather than 500ing when the bucket is not configured", async () => {
    // CI runs with RESUME_BUCKET_NAME unset, and the Playwright spec asserts
    // this route answers 307 or 404. An uncaught probe error would make it a
    // 500 and fail that assertion.
    delete process.env.RESUME_BUCKET_NAME;
    vi.mocked(objectExists).mockRejectedValue(new Error("Bucket is required"));

    const res = await GET();

    expect(res.status).toBe(404);
    expect(objectExists).not.toHaveBeenCalled();
  });

  it("500s, rather than claiming nothing is published, when the probe fails", async () => {
    // A configured bucket that cannot be read is an outage, not an empty one.
    // Answering 404 here pointed on-call at the wrong problem.
    vi.mocked(objectExists).mockRejectedValue(new Error("ExpiredToken"));

    const res = await GET();

    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("500s when the presigned URL is unusable", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(presignDownloadFrom).mockResolvedValue("::::not-a-url::::");

    const res = await GET();

    expect(res.status).toBe(500);
  });

  it("is not cached, because the presigned URL expires", async () => {
    // A cached 307 would hand out a stale signed URL long after its 300s TTL,
    // producing an opaque S3 AccessDenied for the visitor.
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(presignDownloadFrom).mockResolvedValue("https://signed.example/get");

    const res = await GET();

    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });
});
