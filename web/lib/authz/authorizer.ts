import type { Session } from "../auth";
import type { ActionId, ToolId } from "../route-gate";
import { createAvpAuthorizer } from "./avp";
import { createLocalAuthorizer } from "./local";

export type AuthzContext = { now: number; grant?: { remaining: number; expiresAt: number } };
export type AuthzRequest = { session: Session; tool: ToolId; action: ActionId; context: AuthzContext };
export type Decision = "allow" | "deny";

/** Throws when no decision can be made (network, timeout, misconfiguration).
 * Callers treat a throw as a deny. */
export interface Authorizer {
  isAuthorized(request: AuthzRequest): Promise<Decision>;
}

const denyAll: Authorizer = {
  async isAuthorized() {
    console.error("authz: AUTHZ_MODE=local is set on Vercel; denying every request");
    return "deny";
  },
};

const unconfigured: Authorizer = {
  async isAuthorized() {
    throw new Error("authz: AVP_POLICY_STORE_ID is not set");
  },
};

let local: Authorizer | null = null;

export function getAuthorizer(env: NodeJS.ProcessEnv = process.env): Authorizer {
  if (env.AUTHZ_MODE === "local") {
    // Local mode evaluates the Cedar files in-process and trusts the groups in
    // the session cookie. That is only safe where nobody can mint that cookie:
    // e2e runs and a developer's machine. Never on a deployment.
    if (env.VERCEL) return denyAll;
    return (local ??= createLocalAuthorizer(env.COGNITO_USER_POOL_ID ?? ""));
  }
  const store = env.AVP_POLICY_STORE_ID;
  return store ? createAvpAuthorizer(store) : unconfigured;
}
