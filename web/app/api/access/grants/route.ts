import { grantAction } from "@/lib/access-admin";
import { actingEmail, attempt, audit, badRequest, changed, grantBody, respond } from "@/lib/access-api";
import { sendUpdate, sendWelcome } from "@/lib/access-mail";
import { getGrantStore } from "@/lib/authz/grants";

export async function PUT(request: Request) {
  const parsed = grantBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest();
  return respond(async () => {
    const { user, grant, opensTool } = await grantAction({ ...parsed.data, now: Math.floor(Date.now() / 1000) });
    audit({
      by: await actingEmail(),
      op: "grant",
      target: user.email,
      action: grant.action,
      limit: grant.limit,
      expiresAt: grant.expiresAt,
    });
    // The grant is saved by now. Nothing about the email may fail the change.
    const store = getGrantStore();
    let welcomed = true;
    try {
      welcomed = await store.wasWelcomed(user.sub);
    } catch (err) {
      console.error("access: reading the welcome marker failed", err);
    }
    if (welcomed) return changed(await attempt(() => sendUpdate(user, grant, opensTool)));
    const emailError = await attempt(() => sendWelcome(user, grant));
    if (emailError === null) {
      try {
        await store.markWelcomed(user.sub, Math.floor(Date.now() / 1000));
      } catch (err) {
        console.error("access: writing the welcome marker failed", err);
      }
    }
    return changed(emailError);
  });
}
