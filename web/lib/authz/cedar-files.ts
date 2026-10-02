import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The policies live with the Terraform that deploys them. Everything that reads
// them from here (Vitest, `next start` under Playwright) runs with web/ as the
// working directory. Vercel never does: its build has no infra/ directory, and
// the local authorizer refuses to run there.
export const CEDAR_DIR = path.resolve(process.cwd(), "..", "infra", "shared", "cedar");

export type CedarFiles = {
  schema: Record<string, unknown>;
  /** Policy text keyed by file name without `.cedar`, with `${pool}` filled in. */
  policies: Record<string, string>;
};

export function loadCedar(poolId: string, dir: string = CEDAR_DIR): CedarFiles {
  const schema = JSON.parse(readFileSync(path.join(dir, "schema.cedarschema.json"), "utf8"));
  const policyDir = path.join(dir, "policies");
  const policies = Object.fromEntries(
    readdirSync(policyDir)
      .filter((file) => file.endsWith(".cedar"))
      .sort()
      .map((file) => [
        file.replace(/\.cedar$/, ""),
        // Terraform's templatefile() fills in the same placeholder.
        readFileSync(path.join(policyDir, file), "utf8").replaceAll("${pool}", poolId),
      ]),
  );
  return { schema, policies };
}
