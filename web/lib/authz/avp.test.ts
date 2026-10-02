// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { IsAuthorizedWithTokenCommand, VerifiedPermissionsClient } from "@aws-sdk/client-verifiedpermissions";
import { createAvpAuthorizer } from "./avp";
import type { Session } from "../auth";

const avp = mockClient(VerifiedPermissionsClient);
const session: Session = { idToken: "idtok", refreshToken: null, sub: "u1", email: null, groups: ["friends"], expiresAt: 0 };

beforeEach(() => {
  avp.reset();
  process.env.APP_AWS_REGION = "us-east-1";
});

describe("createAvpAuthorizer", () => {
  it("sends the ID token, action, tool and context, and maps ALLOW", async () => {
    avp.on(IsAuthorizedWithTokenCommand).resolves({ decision: "ALLOW", determiningPolicies: [], errors: [] });

    const decision = await createAvpAuthorizer("store1").isAuthorized({
      session,
      tool: "news-desk",
      action: "newsdesk:ask",
      context: { now: 10, grant: { remaining: 2, expiresAt: 20 } },
    });

    expect(decision).toBe("allow");
    expect(avp.commandCalls(IsAuthorizedWithTokenCommand)[0].args[0].input).toEqual({
      policyStoreId: "store1",
      identityToken: "idtok",
      action: { actionType: "Site::Action", actionId: "newsdesk:ask" },
      resource: { entityType: "Site::Tool", entityId: "news-desk" },
      context: {
        contextMap: {
          now: { long: 10 },
          grant: { record: { remaining: { long: 2 }, expiresAt: { long: 20 } } },
        },
      },
    });
  });

  it("sends no grant when there is none, and maps DENY", async () => {
    avp.on(IsAuthorizedWithTokenCommand).resolves({ decision: "DENY", determiningPolicies: [], errors: [] });
    const decision = await createAvpAuthorizer("store1").isAuthorized({ session, tool: "hub", action: "view", context: { now: 10 } });
    expect(decision).toBe("deny");
    expect(avp.commandCalls(IsAuthorizedWithTokenCommand)[0].args[0].input.context).toEqual({ contextMap: { now: { long: 10 } } });
  });

  it("throws when Verified Permissions fails, so the proxy fails closed", async () => {
    avp.on(IsAuthorizedWithTokenCommand).rejects(new Error("AccessDeniedException"));
    await expect(
      createAvpAuthorizer("store1").isAuthorized({ session, tool: "hub", action: "view", context: { now: 10 } }),
    ).rejects.toThrow("AccessDeniedException");
  });
});
