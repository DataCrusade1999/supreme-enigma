import { cookies } from "next/headers";
import { readSession } from "../auth";
import { formatUntil, formatUses } from "../access-format";
import { GRANTS, isMetered } from "../route-gate";
import { isLive } from "./grant-status";
import { getGrantStore, type Grant } from "./grants";

export async function myGrants(): Promise<Grant[]> {
  const secret = process.env.COOKIE_SECRET;
  const session = secret ? readSession(await cookies(), secret) : null;
  if (!session || session.groups.includes("owner")) return [];
  const now = Math.floor(Date.now() / 1000);
  try {
    const grants = await getGrantStore().list(session.sub);
    return grants.filter((g) => isLive(g, now));
  } catch (err) {
    console.error("authz: could not read grants for the hub", err);
    return [];
  }
}

export function describeGrant(grant: Grant): string {
  const until = formatUntil(grant.expiresAt);
  const label = GRANTS[grant.action].label;
  if (!isMetered(grant.action)) return `${label}: until ${until}`;
  const left = (grant.limit ?? 0) - (grant.used ?? 0);
  return `${label}: ${left} of ${formatUses(grant.limit ?? 0)} left, until ${until}`;
}
