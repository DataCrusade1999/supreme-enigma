import { NextResponse } from "next/server";
import { approve } from "@/lib/access-admin";
import { actingEmail, audit, badRequest, respond, subBody } from "@/lib/access-api";

export async function POST(request: Request) {
  const parsed = subBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest();
  return respond(async () => {
    const user = await approve(parsed.data.sub);
    audit({ by: await actingEmail(), op: "approve", target: user.email });
    return NextResponse.json({ ok: true });
  });
}
