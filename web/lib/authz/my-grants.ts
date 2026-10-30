import { cookies } from "next/headers";
import { readSession } from "../auth";
import { METERED_LABELS } from "../route-gate";
import { getGrantStore, type Grant } from "./grants";

export async function myGrants(): Promise<Grant[]> {
  const secret = process.env.COOKIE_SECRET;
  const session = secret ? readSession(await cookies(), secret) : null;
  if (!session || session.groups.includes("owner")) return [];
  const now = Math.floor(Date.now() / 1000);
  try {
    const grants = await getGrantStore().list(session.sub);
    return grants.filter((g) => g.used < g.limit && g.expiresAt > now);
  } catch (err) {
    console.error("authz: could not read grants for the hub", err);
    return [];
  }
}

export function describeGrant(grant: Grant): string {
  const until = new Date(grant.expiresAt * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  return `${METERED_LABELS[grant.action]}: ${grant.limit - grant.used} of ${grant.limit} left, until ${until}`;
}
