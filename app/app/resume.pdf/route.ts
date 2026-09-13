import { NextResponse } from "next/server";
import { objectExists, presignDownloadFrom } from "@/lib/aws";
import { CURRENT_PDF_KEY, resumeBucket } from "@/lib/resume-keys";

// The presigned URL lives 300 seconds, so this response must never be cached —
// a cached redirect would hand out an expired signature and the visitor would
// see an opaque S3 AccessDenied instead of a download.
export const dynamic = "force-dynamic";

export async function GET() {
  // "Nothing to download" and "S3 is not configured here" are the same answer
  // to a visitor: a 404. Letting the probe throw instead would surface as a
  // 500 wherever RESUME_BUCKET_NAME is unset — which includes CI, where the
  // e2e spec asserts this route answers 307 or 404.
  try {
    const bucket = resumeBucket();

    if (!(await objectExists(bucket, CURRENT_PDF_KEY))) {
      return new NextResponse("No resume has been published yet.", { status: 404 });
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
  } catch {
    return new NextResponse("No resume has been published yet.", { status: 404 });
  }
}
