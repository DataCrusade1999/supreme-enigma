import { describe, expect, it } from "vitest";
import {
  newDraftId,
  draftPdfKey,
  draftJsonKey,
  archiveKeys,
  resumeBucket,
  CURRENT_PDF_KEY,
  CURRENT_JSON_KEY,
} from "./resume-keys";

describe("resume keys", () => {
  it("builds draft keys under resume/drafts/<id>/", () => {
    expect(draftPdfKey("abc")).toBe("resume/drafts/abc/resume.pdf");
    expect(draftJsonKey("abc")).toBe("resume/drafts/abc/resume.json");
  });

  it("never puts a resume key under uploads/ or outputs/", () => {
    // uploads/ and outputs/ expire after 1 day. A resume key landing there
    // would be deleted overnight — this is the mistake the module exists to
    // prevent, so it is asserted rather than assumed.
    const keys = [
      draftPdfKey("abc"),
      draftJsonKey("abc"),
      CURRENT_PDF_KEY,
      CURRENT_JSON_KEY,
      archiveKeys(new Date("2026-09-13T10:00:00Z")).pdf,
    ];
    for (const key of keys) {
      expect(key.startsWith("resume/")).toBe(true);
    }
  });

  it("uses fixed keys for the live resume", () => {
    expect(CURRENT_PDF_KEY).toBe("resume/current.pdf");
    expect(CURRENT_JSON_KEY).toBe("resume/current.json");
  });

  it("builds archive keys from an ISO timestamp with no colons", () => {
    // Colons are legal in S3 keys but awkward in URLs and CLI quoting.
    const { pdf, json } = archiveKeys(new Date("2026-09-13T10:20:30.000Z"));
    expect(pdf).toBe("resume/archive/2026-09-13T10-20-30-000Z.pdf");
    expect(json).toBe("resume/archive/2026-09-13T10-20-30-000Z.json");
    expect(pdf).not.toContain(":");
  });

  it("mints a distinct draft id each time", () => {
    expect(newDraftId()).not.toBe(newDraftId());
  });

  it("rejects a draft id that could escape the prefix", () => {
    // The draft id arrives from the client, so it is untrusted input that is
    // concatenated straight into an S3 key.
    expect(() => draftPdfKey("../current")).toThrow();
    expect(() => draftPdfKey("a/b")).toThrow();
    expect(() => draftPdfKey("")).toThrow();
  });

  it("reads the bucket from RESUME_BUCKET_NAME, not S3_BUCKET_NAME", () => {
    // S3_BUCKET_NAME is the per-branch AUDIO bucket. Resume data lives in
    // main's bucket on every branch — see the design spec §4.1.
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
    process.env.S3_BUCKET_NAME = "audio-bucket";
    expect(resumeBucket()).toBe("resume-bucket");
  });
});
