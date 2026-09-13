import { afterEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import {
  keyForUpload,
  deriveOutputKey,
  presignUpload,
  presignUploadTo,
  presignDownloadFrom,
  objectExists,
  MAX_AUDIO_UPLOAD_BYTES,
  MAX_RESUME_UPLOAD_BYTES,
} from "./aws";

describe("keyForUpload", () => {
  it("prefixes with uploads/ and preserves the extension", () => {
    const key = keyForUpload("my song.mp3");
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}\.mp3$/);
  });

  it("handles filenames with no extension", () => {
    const key = keyForUpload("noext");
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}$/);
  });
});

describe("deriveOutputKey", () => {
  it("swaps the uploads/ prefix for outputs/", () => {
    expect(deriveOutputKey("uploads/abc-123.mp3")).toBe("outputs/abc-123.mp3");
  });
});

describe("upload size limits", () => {
  it("caps resume uploads at 5 MB", () => {
    expect(MAX_RESUME_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });

  it("caps audio uploads well above the resume limit", () => {
    expect(MAX_AUDIO_UPLOAD_BYTES).toBeGreaterThan(MAX_RESUME_UPLOAD_BYTES);
  });

  it("signs the content length into the URL", async () => {
    process.env.APP_AWS_REGION = "us-east-1";
    process.env.S3_BUCKET_NAME = "test-bucket";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";

    const url = await presignUpload("uploads/a.mp3", "audio/mpeg", 1234);

    // content-length appears in the signed-headers list, so a client sending a
    // different length fails signature validation rather than being trusted.
    expect(decodeURIComponent(url)).toContain("content-length");
  });
});

describe("bucket-aware helpers", () => {
  it("signs an upload against the bucket it is given, not S3_BUCKET_NAME", async () => {
    process.env.APP_AWS_REGION = "us-east-1";
    process.env.S3_BUCKET_NAME = "audio-bucket";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";

    const url = await presignUploadTo(
      "resume-bucket",
      "resume/drafts/abc/resume.pdf",
      "application/pdf",
      1234,
    );

    expect(url).toContain("resume-bucket");
    expect(url).not.toContain("audio-bucket");
    expect(decodeURIComponent(url)).toContain("content-length");
  });

  it("signs a download against the bucket it is given", async () => {
    process.env.APP_AWS_REGION = "us-east-1";
    process.env.S3_BUCKET_NAME = "audio-bucket";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";

    const url = await presignDownloadFrom("resume-bucket", "resume/current.pdf");

    expect(url).toContain("resume-bucket");
    expect(url).not.toContain("audio-bucket");
  });
});

describe("objectExists", () => {
  // Phase 1's IAM policy granted only object-level Get/Put/Delete. AWS returns
  // 403, not 404, for HeadObject on an absent key when the caller lacks
  // s3:ListBucket — so on that policy every absent-key check threw and the first
  // extraction and the first publish both 500'd. Every route test mocks
  // objectExists, so nothing else in the suite can catch a regression here.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function sendRejects(name: string) {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
      Object.assign(new Error(name), { name }),
    );
  }

  it("reports a missing object as absent", async () => {
    sendRejects("NotFound");
    await expect(objectExists("bucket", "resume/current.json")).resolves.toBe(false);
  });

  it("rethrows a 403 instead of reporting the object as absent", async () => {
    // Treating 403 as "absent" would mask a credential failure as a normal
    // first publish, and publish would then archive nothing before overwriting.
    sendRejects("Forbidden");
    await expect(objectExists("bucket", "resume/current.json")).rejects.toThrow(
      "Forbidden",
    );
  });
});
