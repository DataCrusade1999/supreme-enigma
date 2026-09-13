import { NextResponse } from "next/server";
import { getObjectBytes, putObjectJson } from "@/lib/aws";
import { draftJsonKey, resumeBucket } from "@/lib/resume-keys";
import { resumeSchema } from "@/lib/resume-schema";

export async function PUT(request: Request) {
  const { draftId, resume } = await request.json();

  let key: string;
  try {
    key = draftJsonKey(draftId);
  } catch {
    return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
  }

  // Re-validated server-side. The review UI validates as you type, but a
  // client-side check is a convenience, not an authority.
  const parsed = resumeSchema.safeParse(resume);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "resume did not match the schema", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  await putObjectJson(resumeBucket(), key, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const draftId = new URL(request.url).searchParams.get("draftId") ?? "";

  let key: string;
  try {
    key = draftJsonKey(draftId);
  } catch {
    return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
  }

  const bytes = await getObjectBytes(resumeBucket(), key);
  return NextResponse.json({ resume: JSON.parse(bytes.toString("utf8")) });
}
