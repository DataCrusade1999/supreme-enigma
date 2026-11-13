import { grantAction } from "@/lib/access-admin";
import { actingEmail, audit, badRequest, changed, grantBody, respond } from "@/lib/access-api";
import { sendGrants } from "@/lib/access-mail";
import { getGrantStore, type Grant } from "@/lib/authz/grants";

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
    return changed(await sendGrants(user, await liveGrants(user.sub, grant)));
  });
}

/** Every grant the member can still use. The query is eventually consistent, so
 * it may not show the put that just happened: the other actions come from the
 * read, and the new grant from the write. The grant is saved by now, so a failed
 * read must not turn into a 500 that says nothing changed: the email then lists
 * only the new grant. */
async function liveGrants(sub: string, made: Grant): Promise<Grant[]> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const others = (await getGrantStore().list(sub)).filter(
      (g) => g.action !== made.action && g.used < g.limit && g.expiresAt > now,
    );
    return [...others, made];
  } catch (err) {
    console.error("access: listing grants for the email failed", err);
    return [made];
  }
}
