import {
  IsAuthorizedWithTokenCommand,
  VerifiedPermissionsClient,
  type AttributeValue,
} from "@aws-sdk/client-verifiedpermissions";
import { awsCredentials } from "../aws";
import type { Authorizer, AuthzContext } from "./authorizer";

// Past this the request is denied (spec §3: fail closed after 2 s).
const TIMEOUT_MS = 2000;

let client: VerifiedPermissionsClient | null = null;

// One client per process: the proxy calls this on every gated request.
function getClient(): VerifiedPermissionsClient {
  return (client ??= new VerifiedPermissionsClient({ region: process.env.APP_AWS_REGION!, ...awsCredentials() }));
}

function contextMap(context: AuthzContext): Record<string, AttributeValue> {
  const map: Record<string, AttributeValue> = { now: { long: context.now } };
  if (context.grant) {
    map.grant = {
      record: { remaining: { long: context.grant.remaining }, expiresAt: { long: context.grant.expiresAt } },
    };
  }
  return map;
}

export function createAvpAuthorizer(policyStoreId: string): Authorizer {
  return {
    async isAuthorized({ session, tool, action, context }) {
      const out = await getClient().send(
        new IsAuthorizedWithTokenCommand({
          policyStoreId,
          identityToken: session.idToken,
          action: { actionType: "Site::Action", actionId: action },
          resource: { entityType: "Site::Tool", entityId: tool },
          context: { contextMap: contextMap(context) },
        }),
        { abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      // A policy that errors during evaluation doesn't count toward the decision,
      // which is then still correct; log it so a broken policy gets noticed.
      if (out.errors?.length) {
        console.error("authz: policy evaluation errors", out.errors.map((e) => e.errorDescription));
      }
      return out.decision === "ALLOW" ? "allow" : "deny";
    },
  };
}
