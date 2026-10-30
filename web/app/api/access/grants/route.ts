import { NextResponse } from "next/server";
import { grantAction } from "@/lib/access-admin";
import { actingEmail, audit, badRequest, grantBody, respond } from "@/lib/access-api";

export async function PUT(request: Request) {
  const parsed = grantBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest();
  return respond(async () => {
    const { user, grant } = await grantAction({ ...parsed.data, now: Math.floor(Date.now() / 1000) });
    audit({
      by: await actingEmail(),
      op: "grant",
      target: user.email,
      action: grant.action,
      limit: grant.limit,
      expiresAt: grant.expiresAt,
    });
    return NextResponse.json({ ok: true });
  });
}
