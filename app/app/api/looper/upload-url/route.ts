import { NextRequest, NextResponse } from "next/server";
import { keyForUpload, presignUpload, MAX_AUDIO_UPLOAD_BYTES } from "@/lib/aws";

export async function POST(request: NextRequest) {
  const { filename, contentType, size } = await request.json();

  // Only an upper bound is enforced here. There is deliberately no lower bound:
  // any floor would be an invented number that could refuse a legitimately short
  // clip, and the only way to reach this with a 1-byte size is an authenticated
  // caller bypassing the page on purpose. Undecodable audio is left to the
  // Lambda to reject — garbage in from a caller who had to work at it.
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
