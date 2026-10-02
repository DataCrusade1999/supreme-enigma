import { cookies } from "next/headers";
import { readSession } from "../auth";
import { TOOLS, type Tool } from "../route-gate";
import { getAuthorizer } from "./authorizer";

/** The tools the signed-in user may open, one parallel check per tool (7
 * single calls cost less than one batch call; spec §3). A check that fails
 * hides its tool rather than failing the hub. */
export async function visibleTools(): Promise<Tool[]> {
  const secret = process.env.COOKIE_SECRET;
  const session = secret ? readSession(await cookies(), secret) : null;
  if (!session) return [];

  const authz = getAuthorizer();
  const now = Math.floor(Date.now() / 1000);
  const decisions = await Promise.all(
    TOOLS.map((tool) =>
      authz.isAuthorized({ session, tool: tool.id, action: tool.pageAction, context: { now } }).catch((err) => {
        console.error(`authz: hub check for ${tool.id} failed`, err);
        return "deny" as const;
      }),
    ),
  );
  return TOOLS.filter((_, i) => decisions[i] === "allow");
}
