import { cookies } from "next/headers";
import { readSession } from "../auth";
import { GRANTABLE_TOOLS, TOOLS, type Tool } from "../route-gate";
import { getAuthorizer, type AuthzContext } from "./authorizer";
import { getGrantStore, type Grant } from "./grants";
import { toolAccess } from "./tool-access";

/** The tools the signed-in user may open, one parallel check per tool (7
 * single calls cost less than one batch call; spec §3). A check that fails
 * hides its tool rather than failing the hub. A member's tool access comes from
 * one read of their grants; if it fails, only tools that need no access show. */
export async function visibleTools(): Promise<Tool[]> {
  const secret = process.env.COOKIE_SECRET;
  const session = secret ? readSession(await cookies(), secret) : null;
  if (!session) return [];

  const authz = getAuthorizer();
  const now = Math.floor(Date.now() / 1000);
  let grants: Grant[] = [];
  if (!session.groups.includes("owner")) {
    try {
      grants = await getGrantStore().list(session.sub);
    } catch (err) {
      console.error("authz: could not read grants for the hub", err);
    }
  }
  const contextFor = (tool: Tool): AuthzContext => {
    const access = GRANTABLE_TOOLS.includes(tool.id) ? toolAccess(grants, tool.id, now) : undefined;
    return access ? { now, access } : { now };
  };
  const decisions = await Promise.all(
    TOOLS.map((tool) =>
      authz.isAuthorized({ session, tool: tool.id, action: tool.pageAction, context: contextFor(tool) }).catch((err) => {
        console.error(`authz: hub check for ${tool.id} failed`, err);
        return "deny" as const;
      }),
    ),
  );
  return TOOLS.filter((_, i) => decisions[i] === "allow");
}
