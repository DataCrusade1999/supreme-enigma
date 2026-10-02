// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createLocalAuthorizer } from "./local";
import type { Session } from "../auth";

const as = (groups: string[]): Session => ({ idToken: "x", refreshToken: null, sub: "u1", email: null, groups, expiresAt: 0 });
const authz = createLocalAuthorizer("us-east-1_e2e");

describe("createLocalAuthorizer", () => {
  it("applies the real policies", async () => {
    expect(await authz.isAuthorized({ session: as(["friends"]), tool: "news-desk", action: "view", context: { now: 1 } })).toBe("allow");
    expect(await authz.isAuthorized({ session: as(["friends"]), tool: "resume-admin", action: "view", context: { now: 1 } })).toBe("deny");
    expect(await authz.isAuthorized({ session: as(["owner"]), tool: "resume-admin", action: "resume:publish", context: { now: 1 } })).toBe("allow");
    expect(await authz.isAuthorized({ session: as([]), tool: "hub", action: "view", context: { now: 1 } })).toBe("deny");
  });

  it("honours a grant in the context", async () => {
    const req = { session: as(["friends"]), tool: "news-desk" as const, action: "newsdesk:ask" as const };
    expect(await authz.isAuthorized({ ...req, context: { now: 1 } })).toBe("deny");
    expect(await authz.isAuthorized({ ...req, context: { now: 1, grant: { remaining: 1, expiresAt: 2 } } })).toBe("allow");
  });
});
