import { revokeGrant } from "@/lib/access-admin";
import { actingEmail, attempt, audit, badRequest, changed, grantKey, respond } from "@/lib/access-api";
import { isUnexpired } from "@/lib/authz/grant-status";
import { sendEnded } from "@/lib/access-mail";
import { GRANTS } from "@/lib/route-gate";

export async function DELETE(_request: Request, { params }: { params: Promise<{ sub: string; action: string }> }) {
  const { sub, action } = await params;
  const parsed = grantKey.safeParse(action);
  if (!parsed.success) return badRequest();
  return respond(async () => {
    const { user, removed } = await revokeGrant(sub, parsed.data);
    audit({ by: await actingEmail(), op: "revoke", target: user.email, action: parsed.data });
    if (removed === "unknown") return changed("Couldn't read the grant before revoking it, so no email was sent.");
    const ended = removed !== null && isUnexpired(removed, Math.floor(Date.now() / 1000));
    return changed(ended ? await attempt(() => sendEnded(user, GRANTS[parsed.data].label)) : null);
  });
}
