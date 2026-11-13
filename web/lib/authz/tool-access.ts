import { GRANTS, type ToolId } from "../route-gate";
import { isUnexpired } from "./grant-status";
import type { Grant } from "./grants";

/** The latest expiry among the member's unexpired grants on a tool. A used-up
 * metered grant counts: opening the tool needs time, not uses. */
export function toolAccess(grants: Grant[], tool: ToolId, now: number): { expiresAt: number } | undefined {
  const expiries = grants
    .filter((g) => GRANTS[g.action].tool === tool && isUnexpired(g, now))
    .map((g) => g.expiresAt);
  return expiries.length ? { expiresAt: Math.max(...expiries) } : undefined;
}
