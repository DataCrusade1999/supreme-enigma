import { NextResponse } from "next/server";
import { objectExists, presignDownloadFrom } from "@/lib/aws";
import { CURRENT_PDF_KEY, resumeBucket } from "@/lib/resume-keys";

// The presigned URL lives 300 seconds, so this response must never be cached —
// a cached redirect would hand out an expired signature and the visitor would
// see an opaque S3 AccessDenied instead of a download.
export const dynamic = "force-dynamic";

const NOT_PUBLISHED = "No resume has been published yet.";

export async function GET() {
  // "Nothing to download" and "S3 is not configured here" are the same answer
  // to a visitor: a 404. Reading the env var cannot throw, so checking it here
  // keeps that answer without the blanket catch below having to cover it —
  // which matters because CI and local builds run with RESUME_BUCKET_NAME
  // unset and the e2e spec asserts this route answers 307 or 404 there.
  if (!process.env.RESUME_BUCKET_NAME) {
    return new NextResponse(NOT_PUBLISHED, { status: 404 });
  }

  try {
    const bucket = resumeBucket();

    if (!(await objectExists(bucket, CURRENT_PDF_KEY))) {
      return new NextResponse(NOT_PUBLISHED, { status: 404 });
    }

    // Without this the tab navigates to S3 and either renders the PDF inline
    // or offers to save it as "current.pdf" — the <a download> on /resume
    // cannot name a file across origins.
    const url = await presignDownloadFrom(
      bucket,
      CURRENT_PDF_KEY,
      'attachment; filename="ashutosh-pandey-resume.pdf"',
    );
    return NextResponse.redirect(url, {
      status: 307,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    // Everything reaching here is a real failure against a configured bucket —
    // a broken presign, revoked credentials, S3 unreachable. Reporting those as
    // 404 "nothing published yet" told an on-call engineer the opposite of the
    // truth, and logged nothing to correct it.
    console.error("resume.pdf: failed to produce a signed URL", err);
    return new NextResponse("Resume download is temporarily unavailable.", { status: 500 });
  }
}
