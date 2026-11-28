import { NextResponse } from "next/server";
import type { z } from "@/lib/zod";
import { VpnError } from "./model";
import { getVpnStore, type VpnStore } from "./store";

const STATUS: Record<VpnError["code"], number> = {
  bad_request: 400,
  not_found: 404,
  full: 409,
  conflict: 409,
};

/** Maps a VpnError to its status; anything else is logged and answers 500. */
export async function respond(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof VpnError) {
      return NextResponse.json({ error: err.code }, { status: STATUS[err.code] });
    }
    console.error("vpn: request failed", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/** Runs `run` with the store, or answers 503 when none is configured. */
export function withStore(run: (store: VpnStore) => Promise<Response>): Promise<Response> {
  return respond(async () => {
    const store = getVpnStore();
    if (store === null) return NextResponse.json({ error: "not_configured" }, { status: 503 });
    return run(store);
  });
}

/** Parses the JSON body against `schema`; an unparsable body or a failed schema is bad_request. */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new VpnError("bad_request");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new VpnError("bad_request");
  return parsed.data;
}
