import { removeMember } from "@/lib/access-admin";
import { actingEmail, attempt, audit, changed, respond } from "@/lib/access-api";
import { sendEnded } from "@/lib/access-mail";

// Three calls: leave the group, sign out everywhere, delete grants. If a later
// one fails the member is already out of the group; a retry answers 409, and
// the refresh token still expires within 7 days and grants within their expiry.
export async function DELETE(_request: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  return respond(async () => {
    const { user, hadLive } = await removeMember(sub);
    audit({ by: await actingEmail(), op: "remove", target: user.email });
    return changed(hadLive ? await attempt(() => sendEnded(user, "the tools")) : null);
  });
}
