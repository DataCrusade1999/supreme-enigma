import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { copyObject, objectExists } from "@/lib/aws";
import {
  CURRENT_JSON_KEY,
  CURRENT_PDF_KEY,
  archiveKeys,
  draftJsonKey,
  draftPdfKey,
  resumeBucket,
} from "@/lib/resume-keys";

export async function POST(request: Request) {
  // Application-level rather than IAM-level: all branches share one IAM user,
  // so the credentials retain the S3 permission everywhere. A second,
  // production-only key pair was considered and rejected as more machinery
  // than a single-user site behind a password gate justifies. See spec §7.3.
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { error: "publishing is only available on production" },
      { status: 403 },
    );
  }

  const { draftId } = await request.json();

  let pdfKey: string;
  let jsonKey: string;
  try {
    pdfKey = draftPdfKey(draftId);
    jsonKey = draftJsonKey(draftId);
  } catch {
    return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
  }

  const bucket = resumeBucket();

  // Both halves must be there before anything is overwritten. `resume/drafts/`
  // expires after a day and the two objects are not deleted atomically, so a
  // day-old draft can still have its PDF while its JSON is already gone — and a
  // draft whose extraction 502'd never had a JSON at all. Without this check the
  // first copy lands and the second throws, leaving current.pdf and current.json
  // describing different resumes.
  if (!(await objectExists(bucket, pdfKey)) || !(await objectExists(bucket, jsonKey))) {
    return NextResponse.json(
      { error: "that draft is incomplete or has expired" },
      { status: 404 },
    );
  }

  // Archive before promoting. The reverse order would overwrite the live pair
  // before it had been copied anywhere.
  const archived = await objectExists(bucket, CURRENT_JSON_KEY);
  if (archived) {
    const target = archiveKeys();
    await copyObject(bucket, CURRENT_PDF_KEY, target.pdf);
    await copyObject(bucket, CURRENT_JSON_KEY, target.json);
  }

  // JSON first: it is what the public page renders. If the second copy fails the
  // site shows the new resume with a stale download, which beats the reverse.
  await copyObject(bucket, jsonKey, CURRENT_JSON_KEY);
  await copyObject(bucket, pdfKey, CURRENT_PDF_KEY);

  revalidateTag("resume", { expire: 0 });
  return NextResponse.json({ ok: true, archived });
}
