import { NextResponse } from "next/server";
import { getObjectBytes, objectExists, putObjectJson } from "@/lib/aws";
import { extractResumeFromPdf } from "@/lib/openrouter";
import { draftJsonKey, draftPdfKey, resumeBucket } from "@/lib/resume-keys";
import { resumeSchema } from "@/lib/resume-schema";

// Extraction routinely takes longer than Vercel's default function timeout:
// the PDF transits the route, and the model reads every page.
export const maxDuration = 60;

export async function POST(request: Request) {
  const { draftId, force } = await request.json();

  let pdfKey: string;
  let jsonKey: string;
  try {
    pdfKey = draftPdfKey(draftId);
    jsonKey = draftJsonKey(draftId);
  } catch {
    return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
  }

  const bucket = resumeBucket();

  // Idempotent per draft: a reload of the admin page must not spend another
  // model call. Re-extraction is an explicit choice. See the design spec §9.1.
  if (!force && (await objectExists(bucket, jsonKey))) {
    const existing = await getObjectBytes(bucket, jsonKey);
    return NextResponse.json({
      draftId,
      resume: JSON.parse(existing.toString("utf8")),
      cached: true,
    });
  }

  // Spec §5.3 step 1 — confirm the PDF is there before spending anything.
  // A stale draft id from a bookmarked admin page would otherwise reach
  // getObjectBytes and surface as an unhandled 500.
  if (!(await objectExists(bucket, pdfKey))) {
    return NextResponse.json({ error: "no PDF for that draft" }, { status: 404 });
  }

  const pdf = await getObjectBytes(bucket, pdfKey);

  let raw: unknown;
  try {
    raw = await extractResumeFromPdf(pdf);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "extraction failed" },
      { status: 502 },
    );
  }

  // Validated before anything is written, so a malformed extraction never
  // lands in S3 — the review UI shows `raw` instead. See the design spec §5.3.
  const parsed = resumeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "extraction did not match the schema", issues: parsed.error.issues, raw },
      { status: 422 },
    );
  }

  await putObjectJson(bucket, jsonKey, parsed.data);
  return NextResponse.json({ draftId, resume: parsed.data });
}
