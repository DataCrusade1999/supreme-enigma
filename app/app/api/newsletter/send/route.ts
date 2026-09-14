import { NextResponse } from "next/server";
import { getReader } from "../../../../lib/keystatic-reader";
import { isIssueSent, sendIssue } from "../../../../lib/buttondown";

export async function POST(request: Request) {
  const { slug } = await request.json();
  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  const reader = getReader();
  const entry = await reader.collections.newsletter.read(slug);
  if (!entry) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const alreadySent = await isIssueSent(slug);
  if (alreadySent) {
    return NextResponse.json({ error: "This issue has already been sent" }, { status: 409 });
  }

  const body = await entry.content();
  try {
    await sendIssue({ slug, subject: entry.title, body });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
