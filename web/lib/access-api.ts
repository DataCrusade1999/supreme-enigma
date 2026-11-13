import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "./auth";
import { AccessError } from "./access-admin";
import { GRANT_KEYS, GRANTS } from "./route-gate";

export const grantKey = z.enum(GRANT_KEYS);

export const subBody = z.object({ sub: z.string().min(1).max(128) });

export const grantBody = z.object({
  sub: z.string().min(1).max(128),
  action: grantKey,
  limit: z.number().int().min(1).max(1000).optional(),
  expiresInDays: z.number().int().min(1).max(90).default(7),
  note: z.string().trim().max(200).optional(),
}).transform(({ limit, ...rest }) => (GRANTS[rest.action].metered ? { ...rest, limit: limit ?? 20 } : rest));

/** Who made the change, for the audit line. The proxy already checked access:manage. */
export async function actingEmail(): Promise<string> {
  const secret = process.env.COOKIE_SECRET;
  const session = secret ? readSession(await cookies(), secret) : null;
  return session?.email ?? session?.sub ?? "unknown";
}

export function audit(entry: Record<string, unknown>): void {
  console.info(JSON.stringify({ event: "access", ...entry }));
}

export async function respond(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("access: change failed", err);
    return NextResponse.json({ error: "the change failed; nothing was changed" }, { status: 500 });
  }
}

/** The change succeeded; say so, and pass on why the email didn't go, if it didn't. */
export function changed(emailError: string | null): Response {
  return NextResponse.json(emailError ? { ok: true, emailError } : { ok: true });
}

/** Run a send; a sender that throws is reported like one that returns an error. */
export async function attempt(send: () => Promise<string | null>): Promise<string | null> {
  try {
    return await send();
  } catch (err) {
    console.error("access: email threw", err);
    return err instanceof Error ? `${err.name}: ${err.message}` : "the email could not be sent";
  }
}

export function badRequest(): Response {
  return NextResponse.json({ error: "invalid request" }, { status: 400 });
}
