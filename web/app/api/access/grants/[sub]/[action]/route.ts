import { revokeGrant } from "@/lib/access-admin";
import { actingEmail, audit, badRequest, changed, meteredAction, respond } from "@/lib/access-api";
import { sendEnded } from "@/lib/access-mail";
import { METERED_LABELS } from "@/lib/route-gate";

export async function DELETE(_request: Request, { params }: { params: Promise<{ sub: string; action: string }> }) {
  const { sub, action } = await params;
  const parsed = meteredAction.safeParse(action);
  if (!parsed.success) return badRequest();
  return respond(async () => {
    const user = await revokeGrant(sub, parsed.data);
    audit({ by: await actingEmail(), op: "revoke", target: user.email, action: parsed.data });
    return changed(await sendEnded(user, METERED_LABELS[parsed.data]));
  });
}
