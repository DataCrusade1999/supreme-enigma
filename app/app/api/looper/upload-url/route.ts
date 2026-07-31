import { NextRequest, NextResponse } from "next/server";
import { keyForUpload, presignUpload } from "@/lib/aws";

export async function POST(request: NextRequest) {
  const { filename, contentType } = await request.json();
  const key = keyForUpload(filename);
  const uploadUrl = await presignUpload(key, contentType);
  return NextResponse.json({ key, uploadUrl });
}
