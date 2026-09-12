import { NextRequest, NextResponse } from "next/server";
import { keyForUpload, presignUpload, MAX_AUDIO_UPLOAD_BYTES } from "@/lib/aws";

export async function POST(request: NextRequest) {
  const { filename, contentType, size } = await request.json();

  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return NextResponse.json({ error: "size is required" }, { status: 400 });
  }
  if (size > MAX_AUDIO_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  const key = keyForUpload(filename);
  const uploadUrl = await presignUpload(key, contentType, size);
  return NextResponse.json({ key, uploadUrl });
}
