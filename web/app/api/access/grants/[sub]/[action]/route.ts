import { NextResponse } from "next/server";
import { revokeGrant } from "@/lib/access-admin";
import { actingEmail, audit, badRequest, meteredAction, respond } from "@/lib/access-api";

export async function DELETE(_request: Request, { params }: { params: Promise<{ sub: string; action: string }> }) {
  const { sub, action } = await params;
  const parsed = meteredAction.safeParse(action);
  if (!parsed.success) return badRequest();
  return respond(async () => {
    const user = await revokeGrant(sub, parsed.data);
    audit({ by: await actingEmail(), op: "revoke", target: user.email, action: parsed.data });
    return NextResponse.json({ ok: true });
  });
}
