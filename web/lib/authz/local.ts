import type * as CedarWasm from "@cedar-policy/cedar-wasm/nodejs";
import { loadCedar, type CedarFiles } from "./cedar-files";
import type { Authorizer } from "./authorizer";

type Loaded = { cedar: typeof CedarWasm; files: CedarFiles };

/** The same Cedar files Terraform deploys, evaluated in-process. Used by e2e,
 * which has no Cognito tokens and no AWS. Loaded lazily so production never
 * imports the WASM module. */
export function createLocalAuthorizer(poolId: string): Authorizer {
  let loaded: Promise<Loaded> | null = null;
  const load = () =>
    (loaded ??= import("@cedar-policy/cedar-wasm/nodejs").then((cedar) => ({ cedar, files: loadCedar(poolId) })));

  return {
    async isAuthorized({ session, tool, action, context }) {
      const { cedar, files } = await load();
      const principal = { type: "Site::User", id: `${poolId}|${session.sub}` };
      const parents = session.groups.map((group) => ({ type: "Site::Group", id: `${poolId}|${group}` }));
      const answer = cedar.isAuthorized({
        principal,
        action: { type: "Site::Action", id: action },
        resource: { type: "Site::Tool", id: tool },
        context: context as CedarWasm.Context,
        schema: files.schema as CedarWasm.Schema,
        validateRequest: true,
        policies: { staticPolicies: files.policies },
        entities: [
          { uid: principal, attrs: {}, parents },
          ...parents.map((uid) => ({ uid, attrs: {}, parents: [] })),
        ],
      });
      if (answer.type !== "success") {
        throw new Error(`authz: cedar failed: ${answer.errors.map((e) => e.message).join("; ")}`);
      }
      return answer.response.decision;
    },
  };
}
