import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "./auth";
import { AccessError } from "./access-admin";
import { METERED_ACTIONS } from "./route-gate";

export const meteredAction = z.enum(METERED_ACTIONS);

export const subBody = z.object({ sub: z.string().min(1).max(128) });

export const grantBody = z.object({
  sub: z.string().min(1).max(128),
  action: meteredAction,
  limit: z.number().int().min(1).max(1000).default(20),
  expiresInDays: z.number().int().min(1).max(90).default(7),
  note: z.string().trim().max(200).optional(),
});

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

export function badRequest(): Response {
  return NextResponse.json({ error: "invalid request" }, { status: 400 });
}
