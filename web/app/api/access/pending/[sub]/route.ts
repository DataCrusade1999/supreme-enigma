import { NextResponse } from "next/server";
import { dismiss } from "@/lib/access-admin";
import { actingEmail, audit, respond } from "@/lib/access-api";

export async function DELETE(_request: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  return respond(async () => {
    const user = await dismiss(sub);
    audit({ by: await actingEmail(), op: "dismiss", target: user.email });
    return NextResponse.json({ ok: true });
  });
}
