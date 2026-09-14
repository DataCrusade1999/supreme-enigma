import { NextResponse } from "next/server";
import { getReader } from "../../../../lib/keystatic-reader";
import { isIssueSent, sendIssue } from "../../../../lib/buttondown";

// Sends in flight on THIS instance, keyed by slug. `isIssueSent` narrows the
// double-send window but cannot close it on its own: two requests can both pass
// the check before either creates the email, and a send is irreversible. This
// closes the common case — a double-click, or a second admin tab.
//
// It is deliberately not a complete fix. Vercel runs this route on more than one
// serverless instance, and a Map is per-instance, so two requests landing on
// different instances still race. Closing that needs either durable state (ruled
// out by the design — no database, no new AWS resource) or a verified guarantee
// that Buttondown itself rejects a duplicate client-supplied slug. Tracked in #131.
const inFlight = new Set<string>();

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (payload as { slug?: unknown } | null)?.slug;
  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  // Claimed before any further await, so nothing can interleave between the
  // check and the claim.
  if (inFlight.has(slug)) {
    return NextResponse.json(
      { error: "A send for this issue is already in progress" },
      { status: 409 },
    );
  }
  inFlight.add(slug);

  try {
    const reader = getReader();
    const entry = await reader.collections.newsletter.read(slug);
    if (!entry) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    let alreadySent: boolean;
    try {
      alreadySent = await isIssueSent(slug);
    } catch (err) {
      // Never fall through to a send on an unverified status — an unreachable
      // Buttondown must read as "unknown", not "safe to send".
      const message = err instanceof Error ? err.message : "unknown error";
      return NextResponse.json(
        { error: `Status check failed: ${message}` },
        { status: 502 },
      );
    }

    if (alreadySent) {
      return NextResponse.json(
        { error: "This issue has already been sent" },
        { status: 409 },
      );
    }

    const body = await entry.content();
    try {
      await sendIssue({ slug, subject: entry.title, body });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Send failed";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } finally {
    inFlight.delete(slug);
  }
}
