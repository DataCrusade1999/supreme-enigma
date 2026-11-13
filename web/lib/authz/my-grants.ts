import { cookies } from "next/headers";
import { readSession } from "../auth";
import { GRANTS } from "../route-gate";
import { getGrantStore, type Grant } from "./grants";

export async function myGrants(): Promise<Grant[]> {
  const secret = process.env.COOKIE_SECRET;
  const session = secret ? readSession(await cookies(), secret) : null;
  if (!session || session.groups.includes("owner")) return [];
  const now = Math.floor(Date.now() / 1000);
  try {
    const grants = await getGrantStore().list(session.sub);
    return grants.filter((g) => (g.used ?? 0) < (g.limit ?? 0) && g.expiresAt > now);
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
  return `${GRANTS[grant.action].label}: ${(grant.limit ?? 0) - (grant.used ?? 0)} of ${grant.limit ?? 0} left, until ${until}`;
}
