import { randomUUID } from "crypto";

// Deliberately a separate module from lib/aws.ts. That file's keyForUpload
// writes to uploads/, whose 1-day lifecycle rule would delete a resume
// overnight — keeping the resume key vocabulary apart makes that mistake
// hard to make by accident. See the design spec §4.2.

export const CURRENT_PDF_KEY = "resume/current.pdf";
export const CURRENT_JSON_KEY = "resume/current.json";

export function newDraftId(): string {
  return randomUUID();
}

function assertSafeDraftId(draftId: string): void {
  // The draft id comes from the client and is concatenated into an S3 key.
  // Anything but plain uuid characters could walk out of the prefix and
  // overwrite resume/current.pdf.
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(draftId)) {
    throw new Error("invalid draft id");
  }
}

export function draftPdfKey(draftId: string): string {
  assertSafeDraftId(draftId);
  return `resume/drafts/${draftId}/resume.pdf`;
}

export function draftJsonKey(draftId: string): string {
  assertSafeDraftId(draftId);
  return `resume/drafts/${draftId}/resume.json`;
}

export function archiveKeys(now = new Date()): { pdf: string; json: string } {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return {
    pdf: `resume/archive/${stamp}.pdf`,
    json: `resume/archive/${stamp}.json`,
  };
}

// All three branches read and write main's bucket for resume data, so this is
// the env-agnostic RESUME_BUCKET_NAME rather than the per-branch
// S3_BUCKET_NAME. See the design spec §4.1.
export function resumeBucket(): string {
  return process.env.RESUME_BUCKET_NAME!;
}
