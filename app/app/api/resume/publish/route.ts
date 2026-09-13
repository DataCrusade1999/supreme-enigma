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

  // Archive before promoting. The reverse order would overwrite the live pair
  // before it had been copied anywhere.
  const archived = await objectExists(bucket, CURRENT_JSON_KEY);
  if (archived) {
    const target = archiveKeys();
    await copyObject(bucket, CURRENT_PDF_KEY, target.pdf);
    await copyObject(bucket, CURRENT_JSON_KEY, target.json);
  }

  await copyObject(bucket, pdfKey, CURRENT_PDF_KEY);
  await copyObject(bucket, jsonKey, CURRENT_JSON_KEY);

  revalidateTag("resume", { expire: 0 });
  return NextResponse.json({ ok: true, archived });
}
