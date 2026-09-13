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

  // Same exposure the extract route guards: a bookmarked admin page, or a draft
  // that has aged past the 1-day `resume/drafts/` expiry, sends a well-formed id
  // whose object is gone. Without this it surfaces as an unhandled 500 with no
  // body the caller can read.
  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(resumeBucket(), key);
  } catch {
    return NextResponse.json({ error: "no draft for that id" }, { status: 404 });
  }

  try {
    return NextResponse.json({ resume: JSON.parse(bytes.toString("utf8")) });
  } catch {
    return NextResponse.json({ error: "stored draft was not valid JSON" }, { status: 422 });
  }
}
