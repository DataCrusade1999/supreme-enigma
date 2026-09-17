import { NextResponse } from "next/server";
import { MAX_RESUME_UPLOAD_BYTES, presignUploadTo } from "@/lib/aws";
import { draftPdfKey, newDraftId, resumeBucket } from "@/lib/resume-keys";

export async function POST(request: Request) {
  const { contentType, size } = await request.json();

  if (contentType !== "application/pdf") {
    return NextResponse.json({ error: "a PDF is required" }, { status: 415 });
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return NextResponse.json({ error: "size is required" }, { status: 400 });
  }
  // Checked here AND bound into the signature below. The server-side check
  // gives a clean error; the signed ContentLength is what actually stops the
  // bytes landing, since a size checked after the fact has already been paid
  // for. See the design spec §9.1.
  if (size > MAX_RESUME_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  const draftId = newDraftId();
  const uploadUrl = await presignUploadTo(
    resumeBucket(),
    draftPdfKey(draftId),
    contentType,
    size,
  );
  return NextResponse.json({ draftId, uploadUrl });
}
