// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { getAuthorizer } from "./authorizer";
import type { Session } from "../auth";

const owner: Session = { idToken: "x", refreshToken: null, sub: "u1", email: null, groups: ["owner"], expiresAt: 0 };
const req = { session: owner, tool: "hub" as const, action: "view" as const, context: { now: 1 } };

describe("getAuthorizer", () => {
  it("uses the local Cedar files under AUTHZ_MODE=local off Vercel", async () => {
    const authz = getAuthorizer({ AUTHZ_MODE: "local", COGNITO_USER_POOL_ID: "us-east-1_e2e" } as NodeJS.ProcessEnv);
    expect(await authz.isAuthorized(req)).toBe("allow");
  });

  // The guard the spec promises: local mode trusts the groups in the cookie, so
  // it must never decide anything on a Vercel deployment.
  it("denies everything when AUTHZ_MODE=local is set on Vercel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const authz = getAuthorizer({ AUTHZ_MODE: "local", VERCEL: "1", COGNITO_USER_POOL_ID: "p" } as NodeJS.ProcessEnv);
    expect(await authz.isAuthorized(req)).toBe("deny");
  });

  it("throws when the policy store ID is missing, so the proxy fails closed", async () => {
    const authz = getAuthorizer({} as NodeJS.ProcessEnv);
    await expect(authz.isAuthorized(req)).rejects.toThrow("AVP_POLICY_STORE_ID");
  });
});
