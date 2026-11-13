import { approve } from "@/lib/access-admin";
import { actingEmail, audit, badRequest, changed, respond, subBody } from "@/lib/access-api";
import { sendApproved } from "@/lib/access-mail";

export async function POST(request: Request) {
  const parsed = subBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest();
  return respond(async () => {
    const user = await approve(parsed.data.sub);
    audit({ by: await actingEmail(), op: "approve", target: user.email });
    return changed(await sendApproved(user));
  });
}
