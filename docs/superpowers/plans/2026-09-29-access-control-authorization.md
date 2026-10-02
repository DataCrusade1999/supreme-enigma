# Access control, part 1: authorization core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every gated request is allowed or denied by Amazon Verified Permissions, from Cedar policies, with Cognito groups `owner` and `friends` as the identity source, and the session carries the user's Cognito tokens.

**Architecture:** Terraform creates a Verified Permissions policy store whose schema and four policies are files under `infra/shared/cedar/`. The callback stops checking `OWNER_EMAIL` and seals the ID and refresh tokens into two encrypted cookies. `proxy.ts` maps `(method, path)` to `(tool, action)` through `ROUTE_ACTIONS` in `route-gate.ts`, refreshes the ID token when it is about to expire, and asks an `Authorizer` for a decision: Verified Permissions in production, the same Cedar files evaluated in-process under e2e.

**Tech Stack:** Next.js 16 (`proxy.ts` on Node.js), TypeScript, Vitest, Playwright, `@aws-sdk/client-verifiedpermissions`, `@cedar-policy/cedar-wasm` (dev only), Terraform `hashicorp/aws ~> 6.62`.

**Spec:** `docs/superpowers/specs/2026-09-29-access-control-design.md` (§3, §4, §5, §8 `access.tf`/`auth.tf`, §9, §10, §11 PR 1). Parts 2 and 3 are `2026-09-29-access-control-grants.md` and `2026-09-29-access-control-email.md`.

## Global Constraints

- Three PRs into `dev`, in order, each saying `Refs #300` (part 3 closes the issue), each merged with `gh pr merge <N> --squash --delete-branch` after invoking the `merging-a-pr` skill:
  1. `chore/access-control-ci-perms` (Task 0): the CI apply role's new permissions.
  2. `feat/access-control-store` (Tasks 1–2): the Cedar files and the Terraform.
  3. `feat/access-control-core` (Tasks 3–12): the web change.
  Each waits for the one before it to merge and for the `Terraform` workflow's apply on `dev` to finish. A Vercel deployment keeps the env vars it was created with, and the deployment for a push to `dev` is created before CI's apply sets `AVP_POLICY_STORE_ID`, so the web change cannot share a PR with the Terraform that creates it.
- Commits end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.
- Every manual `aws` command takes `--profile personal --region us-east-1`.
- Terraform runs in CI (`.github/workflows/terraform.yml`). A PR that touches `infra/` gets a plan comment per stack; read it before merging (root `CLAUDE.md` § Merging a PR). A push to `dev` applies `shared` with `tf_apply_prod`, so everything in `infra/shared` reaches production when it merges to `dev`. A plan that destroys or replaces anything stops the apply until someone runs the workflow by hand with `confirm: apply-destroys`. Local runs (`infra/shared/`, `AWS_PROFILE=personal`, `-var-file=terraform.tfvars`) are for `fmt`/`validate` and the break-glass path, not the normal apply.
- Cedar namespace `Site`. Entity types `Site::User`, `Site::Group`, `Site::Tool`. Group entity IDs are `<user pool ID>|<group name>`; the policy files write that as `${pool}|owner`.
- Tool IDs: `hub`, `bgm-looper`, `money-planner`, `news-desk`, `resume-admin`, `newsletter-admin`, `keystatic`, `access-admin`.
- Action IDs: `view`, `newsdesk:pin` (group `free`); `looper:process`, `newsdesk:refresh`, `newsdesk:ask` (group `metered`); `resume:draft`, `resume:extract`, `resume:publish`, `newsletter:send`, `keystatic:use`, `access:manage` (group `ownerOnly`).
- Cookies: `site_id` (sealed ID token) and `site_refresh` (sealed refresh token), `httpOnly`, `Secure`, `SameSite=Lax`, path `/`, max age 7 days. AES-256-GCM, key from HKDF-SHA256 over `COOKIE_SECRET` with info `site-session-v1`.
- Token lifetimes: ID and access token 15 minutes, refresh token 7 days. Refresh when the ID token has 60 s or less left.
- Authorization fails closed: an error or a 2 s timeout from Verified Permissions is a deny (503 for APIs).
- `AUTHZ_MODE=local` only when `VERCEL` is unset. With `VERCEL` set it denies everything.
- Denial pages are redirects: `/access-requested` for a signed-in user in neither group, `/access-denied?reason=…&tool=…&action=…` otherwise. APIs get JSON: 401 `unauthorized`, 403 `no_access` / `forbidden` / `no_grant`, 503 `authorization_unavailable`.
- Request address: `access@ashutosh-pandey.com`.
- Writing: plain prose in comments, docs and commit messages (root `CLAUDE.md` § Writing).
- Read `web/node_modules/next/dist/docs/` for any Next API you're unsure of (`web/AGENTS.md`). Proxy docs: `01-app/03-api-reference/03-file-conventions/proxy.md`.

## Review Focus

1. **Expired ID token and a failed refresh.** Both cookies are cleared, a page goes to `/login?next=…` and an API gets 401. Never a 500, never a redirect loop. Test in Task 8.
2. **A token without `cognito:groups`** (a first-time Google user). `readSession` returns `groups: []`, and the proxy sends the user to `/access-requested`. Tests in Tasks 4 and 8.
3. **Method and path edge cases.** `HEAD` maps like `GET`, a trailing slash maps like no slash, and a `POST` to a page path is unmapped and denied. Test in Task 5.
4. **`AUTHZ_MODE=local` with `VERCEL` set.** Every decision is a deny. Test in Task 7.
5. **The refreshed token reaches the page.** After a refresh, the hub (a server component reading `cookies()`) sees the new token, not the expired one. Otherwise Verified Permissions rejects the expired token and the hub lists nothing. Test in Task 8: the response overrides the request's `cookie` header.
6. **`mailto:` subjects with `:` and spaces.** The request-access link percent-encodes them with `encodeURIComponent`, not `URLSearchParams` (which writes spaces as `+`). Test in Task 9.

---

### Task 0: Let CI apply Verified Permissions and DynamoDB

`tf_apply_prod` applies `shared` from `dev`, and its `Services` statement has no `verifiedpermissions:*` or `dynamodb:*`. Without them Task 2's apply fails with `AccessDenied`. The permission goes in its own PR because a role cannot reliably use a grant made in the same apply (IAM is eventually consistent). `dynamodb:*` is for part 2's grants table; it is added now so part 2 doesn't need a PR of its own for it.

**Files:**
- Modify: `infra/shared/ci.tf` (`data "aws_iam_policy_document" "tf_apply_prod"`, statement `Services`)

- [ ] **Step 1: Branch**

```bash
cd /e/Personal/looper && git switch dev && git pull && git switch -c chore/access-control-ci-perms
```

- [ ] **Step 2: Add the two services**

In `tf_apply_prod`'s `Services` statement, change the `actions` list to:

```hcl
    actions = [
      "lambda:*", "cloudwatch:*", "sns:*", "budgets:*", "ecr:*",
      "cognito-idp:*", "ses:*", "acm:*", "logs:*",
      "verifiedpermissions:*", "dynamodb:*",
    ]
```

`tf_apply_nonprod` doesn't change: it applies only `envs/dev` and `envs/stage`, which hold none of these resources.

- [ ] **Step 3: Format, commit, PR**

```bash
cd /e/Personal/looper/infra/shared && terraform fmt -check
cd /e/Personal/looper
git add infra/shared/ci.tf
git commit -m "chore(infra): let CI apply Verified Permissions and DynamoDB (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin chore/access-control-ci-perms
gh pr create --base dev --title "chore(infra): let CI apply Verified Permissions and DynamoDB (#300)" --body "$(cat <<'EOF'
The access control work (#300) adds a Verified Permissions policy store and a DynamoDB table to infra/shared. tf_apply_prod, which applies shared from dev, has neither service. This adds both, in its own PR so the grant is in place before the apply that needs it.

Refs #300
EOF
)"
```

- [ ] **Step 4: Merge and wait for the apply**

The `Terraform` workflow's plan comment must show `shared`: `1 to change` (`aws_iam_role_policy.tf_apply_prod`), and `No changes` for every other stack. Invoke the `merging-a-pr` skill and merge. Then wait for the apply on `dev`:

```bash
gh run list --workflow terraform.yml --branch dev --limit 1
gh run watch <id> --exit-status
```

---

### Task 1: Cedar schema, policies and offline policy tests

**Files:**
- Create: `infra/shared/cedar/schema.cedarschema.json`
- Create: `infra/shared/cedar/policies/owner-all.cedar`, `friends-free.cedar`, `friends-metered.cedar`, `owner-only-guard.cedar`
- Create: `web/lib/authz/cedar-files.ts`
- Test: `web/lib/authz/policies.test.ts`
- Modify: `web/package.json` (dev dependency)

**Interfaces:**
- Produces: `loadCedar(poolId: string, dir?: string): CedarFiles` with `CedarFiles = { schema: Record<string, unknown>; policies: Record<string, string> }`; `CEDAR_DIR` (absolute path to `infra/shared/cedar`, resolved from `process.cwd()`, which is `web/` under Vitest, `next start` and Playwright).

- [ ] **Step 1: Branch and install the Cedar evaluator**

```bash
cd /e/Personal/looper && git switch dev && git pull && git switch -c feat/access-control-store
cd web && npm install --save-dev @cedar-policy/cedar-wasm@^4.13.0
```

- [ ] **Step 2: Write the schema**

`infra/shared/cedar/schema.cedarschema.json`:

```json
{
  "Site": {
    "entityTypes": {
      "Group": {},
      "User": {
        "memberOfTypes": ["Group"],
        "shape": {
          "type": "Record",
          "attributes": {
            "email": { "type": "String", "required": false }
          }
        }
      },
      "Tool": {}
    },
    "actions": {
      "free": {},
      "metered": {},
      "ownerOnly": {},
      "view": { "memberOf": [{ "id": "free" }], "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Tool"], "context": { "type": "Record", "attributes": { "now": { "type": "Long" }, "grant": { "type": "Record", "required": false, "attributes": { "remaining": { "type": "Long" }, "expiresAt": { "type": "Long" } } } } } } },
      "newsdesk:pin": { "memberOf": [{ "id": "free" }], "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Tool"], "context": { "type": "Record", "attributes": { "now": { "type": "Long" }, "grant": { "type": "Record", "required": false, "attributes": { "remaining": { "type": "Long" }, "expiresAt": { "type": "Long" } } } } } } },
      "looper:process": { "memberOf": [{ "id": "metered" }], "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Tool"], "context": { "type": "Record", "attributes": { "now": { "type": "Long" }, "grant": { "type": "Record", "required": false, "attributes": { "remaining": { "type": "Long" }, "expiresAt": { "type": "Long" } } } } } } },
      "newsdesk:refresh": { "memberOf": [{ "id": "metered" }], "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Tool"], "context": { "type": "Record", "attributes": { "now": { "type": "Long" }, "grant": { "type": "Record", "required": false, "attributes": { "remaining": { "type": "Long" }, "expiresAt": { "type": "Long" } } } } } } },
      "newsdesk:ask": { "memberOf": [{ "id": "metered" }], "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Tool"], "context": { "type": "Record", "attributes": { "now": { "type": "Long" }, "grant": { "type": "Record", "required": false, "attributes": { "remaining": { "type": "Long" }, "expiresAt": { "type": "Long" } } } } } } },
      "resume:draft": { "memberOf": [{ "id": "ownerOnly" }], "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Tool"], "context": { "type": "Record", "attributes": { "now": { "type": "Long" }, "grant": { "type": "Record", "required": false, "attributes": { "remaining": { "type": "Long" }, "expiresAt": { "type": "Long" } } } } } } },
      "resume:extract": { "memberOf": [{ "id": "ownerOnly" }], "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Tool"], "context": { "type": "Record", "attributes": { "now": { "type": "Long" }, "grant": { "type": "Record", "required": false, "attributes": { "remaining": { "type": "Long" }, "expiresAt": { "type": "Long" } } } } } } },
      "resume:publish": { "memberOf": [{ "id": "ownerOnly" }], "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Tool"], "context": { "type": "Record", "attributes": { "now": { "type": "Long" }, "grant": { "type": "Record", "required": false, "attributes": { "remaining": { "type": "Long" }, "expiresAt": { "type": "Long" } } } } } } },
      "newsletter:send": { "memberOf": [{ "id": "ownerOnly" }], "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Tool"], "context": { "type": "Record", "attributes": { "now": { "type": "Long" }, "grant": { "type": "Record", "required": false, "attributes": { "remaining": { "type": "Long" }, "expiresAt": { "type": "Long" } } } } } } },
      "keystatic:use": { "memberOf": [{ "id": "ownerOnly" }], "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Tool"], "context": { "type": "Record", "attributes": { "now": { "type": "Long" }, "grant": { "type": "Record", "required": false, "attributes": { "remaining": { "type": "Long" }, "expiresAt": { "type": "Long" } } } } } } },
      "access:manage": { "memberOf": [{ "id": "ownerOnly" }], "appliesTo": { "principalTypes": ["User"], "resourceTypes": ["Tool"], "context": { "type": "Record", "attributes": { "now": { "type": "Long" }, "grant": { "type": "Record", "required": false, "attributes": { "remaining": { "type": "Long" }, "expiresAt": { "type": "Long" } } } } } } }
    }
  }
}
```

The context shape is repeated per action rather than declared once under `commonTypes`: the plain JSON form is what Verified Permissions documents, and repeating it avoids depending on common-type support there. This schema was checked with `cedar-wasm` 4.13 in strict mode during planning.

- [ ] **Step 3: Write the four policies**

No `@id` annotations: Terraform names each policy by file, and the tests key them by file name.

`infra/shared/cedar/policies/owner-all.cedar`:

```cedar
permit (principal in Site::Group::"${pool}|owner", action, resource);
```

`infra/shared/cedar/policies/friends-free.cedar`:

```cedar
permit (principal in Site::Group::"${pool}|friends", action in Site::Action::"free", resource)
when {
  resource in [Site::Tool::"hub", Site::Tool::"bgm-looper", Site::Tool::"money-planner", Site::Tool::"news-desk"]
};
```

`infra/shared/cedar/policies/friends-metered.cedar`:

```cedar
permit (principal in Site::Group::"${pool}|friends", action in Site::Action::"metered", resource)
when {
  context has grant &&
  context.grant.remaining > 0 &&
  context.now < context.grant.expiresAt
};
```

`infra/shared/cedar/policies/owner-only-guard.cedar`:

```cedar
forbid (principal, action in Site::Action::"ownerOnly", resource)
unless { principal in Site::Group::"${pool}|owner" };
```

- [ ] **Step 4: Write the loader**

`web/lib/authz/cedar-files.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The policies live with the Terraform that deploys them. Everything that reads
// them from here (Vitest, `next start` under Playwright) runs with web/ as the
// working directory. Vercel never does: its build has no infra/ directory, and
// the local authorizer refuses to run there.
export const CEDAR_DIR = path.resolve(process.cwd(), "..", "infra", "main", "cedar");

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
```

- [ ] **Step 5: Write the failing policy tests**

`web/lib/authz/policies.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import { loadCedar } from "./cedar-files";

const POOL = "us-east-1_test";
const files = loadCedar(POOL);

type Grant = { remaining: number; expiresAt: number };
const NOW = 1_800_000_000;

function decide(groups: string[], action: string, tool: string, grant?: Grant) {
  const principal = { type: "Site::User", id: `${POOL}|user-1` };
  const parents = groups.map((g) => ({ type: "Site::Group", id: `${POOL}|${g}` }));
  const answer = cedar.isAuthorized({
    principal,
    action: { type: "Site::Action", id: action },
    resource: { type: "Site::Tool", id: tool },
    context: grant ? { now: NOW, grant } : { now: NOW },
    schema: files.schema as cedar.Schema,
    validateRequest: true,
    policies: { staticPolicies: files.policies },
    entities: [
      { uid: principal, attrs: {}, parents },
      ...parents.map((uid) => ({ uid, attrs: {}, parents: [] })),
    ],
  });
  if (answer.type !== "success") throw new Error(JSON.stringify(answer.errors));
  return answer.response.decision;
}

const ACTIVE: Grant = { remaining: 3, expiresAt: NOW + 3600 };
const USED_UP: Grant = { remaining: 0, expiresAt: NOW + 3600 };
const EXPIRED: Grant = { remaining: 3, expiresAt: NOW };

const OWNER_ONLY: [string, string][] = [
  ["resume:draft", "resume-admin"],
  ["resume:extract", "resume-admin"],
  ["resume:publish", "resume-admin"],
  ["newsletter:send", "newsletter-admin"],
  ["keystatic:use", "keystatic"],
  ["access:manage", "access-admin"],
];
const METERED: [string, string][] = [
  ["looper:process", "bgm-looper"],
  ["newsdesk:refresh", "news-desk"],
  ["newsdesk:ask", "news-desk"],
];

describe("Cedar schema and policies", () => {
  it("validate in strict mode", () => {
    const answer = cedar.validate({
      schema: files.schema as cedar.Schema,
      policies: { staticPolicies: files.policies },
      validationSettings: { mode: "strict" },
    });
    expect(answer).toMatchObject({ type: "success", validationErrors: [] });
  });

  it("are exactly the four the spec names", () => {
    expect(Object.keys(files.policies)).toEqual([
      "friends-free",
      "friends-metered",
      "owner-all",
      "owner-only-guard",
    ]);
  });
});

describe("owner", () => {
  it.each([...OWNER_ONLY, ...METERED, ["view", "resume-admin"], ["view", "hub"]])(
    "may %s on %s with no grant",
    (action, tool) => {
      expect(decide(["owner"], action, tool)).toBe("allow");
    },
  );
});

describe("friends", () => {
  it.each(["hub", "bgm-looper", "money-planner", "news-desk"])("may view %s", (tool) => {
    expect(decide(["friends"], "view", tool)).toBe("allow");
  });

  it("may pin News Desk indicators", () => {
    expect(decide(["friends"], "newsdesk:pin", "news-desk")).toBe("allow");
  });

  it.each(["resume-admin", "newsletter-admin", "keystatic", "access-admin"])("may not view %s", (tool) => {
    expect(decide(["friends"], "view", tool)).toBe("deny");
  });

  it.each(METERED)("%s on %s needs a grant", (action, tool) => {
    expect(decide(["friends"], action, tool)).toBe("deny");
    expect(decide(["friends"], action, tool, ACTIVE)).toBe("allow");
    expect(decide(["friends"], action, tool, USED_UP)).toBe("deny");
    expect(decide(["friends"], action, tool, EXPIRED)).toBe("deny");
  });

  // The forbid policy: a live grant must never open an owner-only action.
  it.each(OWNER_ONLY)("may never %s on %s, even holding a grant", (action, tool) => {
    expect(decide(["friends"], action, tool, ACTIVE)).toBe("deny");
  });
});

describe("users in neither group", () => {
  it.each([[[]], [[`${POOL}_Google`]]])("groups %j are denied everything", (groups) => {
    expect(decide(groups as string[], "view", "hub")).toBe("deny");
    expect(decide(groups as string[], "newsdesk:ask", "news-desk", ACTIVE)).toBe("deny");
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `cd web && npx vitest run lib/authz/policies.test.ts`
Expected: all PASS. If the import of `@cedar-policy/cedar-wasm/nodejs` fails, the package isn't installed (Step 1). If a policy test fails, the policy text is wrong: fix the `.cedar` file, never the test.

- [ ] **Step 7: Commit**

```bash
cd /e/Personal/looper
git add infra/shared/cedar web/lib/authz web/package.json web/package-lock.json
git commit -m "feat(access): Cedar schema and policies with offline tests (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 2: Terraform — policy store, groups, token lifetimes

**Files:**
- Create: `infra/shared/access.tf`
- Modify: `infra/shared/auth.tf` (the `aws_cognito_user_pool_client.web` block, lines 179-191)

**Interfaces:**
- Consumes: the Cedar files from Task 1.
- Produces: Vercel env var `AVP_POLICY_STORE_ID`; Cognito groups `owner` and `friends`, with the owner user in `owner`; both Vercel roles may call `verifiedpermissions:IsAuthorizedWithToken` on the store.

- [ ] **Step 1: Write `access.tf`**

```hcl
# Fine-grained access to /tools (spec 2026-09-29-access-control-design.md).
# Verified Permissions decides every gated request from the Cedar files under
# cedar/, with the Cognito user pool as its identity source. Shared by all three
# branches, like the pool: a person's access doesn't depend on the environment.

resource "aws_verifiedpermissions_policy_store" "site" {
  description = "Access to the /tools namespace"

  validation_settings {
    mode = "STRICT"
  }
}

resource "aws_verifiedpermissions_schema" "site" {
  policy_store_id = aws_verifiedpermissions_policy_store.site.id

  definition {
    value = jsonencode(jsondecode(file("${path.module}/cedar/schema.cedarschema.json")))
  }
}

# One resource per file, named by the file. Group entity IDs carry the pool ID
# ("<pool>|owner"), which the files write as ${pool}.
resource "aws_verifiedpermissions_policy" "site" {
  for_each        = fileset("${path.module}/cedar/policies", "*.cedar")
  policy_store_id = aws_verifiedpermissions_policy_store.site.id

  definition {
    static {
      description = trimsuffix(each.value, ".cedar")
      statement   = templatefile("${path.module}/cedar/policies/${each.value}", { pool = aws_cognito_user_pool.owner.id })
    }
  }

  # STRICT checks each policy against the schema, so the schema has to exist first.
  depends_on = [aws_verifiedpermissions_schema.site]
}

# ID tokens from the web client become Site::User "<pool>|<sub>", and their
# cognito:groups become Site::Group parents.
resource "aws_verifiedpermissions_identity_source" "cognito" {
  policy_store_id       = aws_verifiedpermissions_policy_store.site.id
  principal_entity_type = "Site::User"

  configuration {
    cognito_user_pool_configuration {
      user_pool_arn = aws_cognito_user_pool.owner.arn
      client_ids    = [aws_cognito_user_pool_client.web.id]

      group_configuration {
        group_entity_type = "Site::Group"
      }
    }
  }

  depends_on = [aws_verifiedpermissions_schema.site]
}

resource "aws_cognito_user_group" "owner" {
  name         = "owner"
  user_pool_id = aws_cognito_user_pool.owner.id
  description  = "Everything, including the owner-only tools"
}

resource "aws_cognito_user_group" "friends" {
  name         = "friends"
  user_pool_id = aws_cognito_user_pool.owner.id
  description  = "The shareable tools' free actions; metered actions need a grant"
}

# The pool uses email as the username alias, so the email identifies the owner
# to the admin API even though Cognito stores a UUID as the username.
resource "aws_cognito_user_in_group" "owner" {
  user_pool_id = aws_cognito_user_pool.owner.id
  group_name   = aws_cognito_user_group.owner.name
  username     = aws_cognito_user.owner.username
}

# Both Vercel roles get the same statements: production assumes aws_iam_role.vercel,
# dev and stage assume aws_iam_role.vercel_preview, and everything here (the policy
# store, later the pool and the grants table) is shared by all three environments.
# Same pattern as vercel_resume_statements in shared.tf.
locals {
  vercel_access_statements = [
    {
      Sid      = "AuthorizeRequests"
      Effect   = "Allow"
      Action   = ["verifiedpermissions:IsAuthorizedWithToken"]
      Resource = [aws_verifiedpermissions_policy_store.site.arn]
    },
  ]
}

resource "aws_iam_role_policy" "vercel_access" {
  name   = "${var.project_name}-vercel-access"
  role   = aws_iam_role.vercel.id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.vercel_access_statements })
}

resource "aws_iam_role_policy" "vercel_preview_access" {
  name   = "${var.project_name}-vercel-preview-access"
  role   = aws_iam_role.vercel_preview.id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.vercel_access_statements })
}

resource "vercel_project_environment_variable" "avp_policy_store_id" {
  project_id = vercel_project.looper.id
  key        = "AVP_POLICY_STORE_ID"
  value      = aws_verifiedpermissions_policy_store.site.id
  target     = local.env_targets
  sensitive  = false
}
```

- [ ] **Step 2: Set token lifetimes on the web client**

In `infra/shared/auth.tf`, inside `resource "aws_cognito_user_pool_client" "web"`, after `prevent_user_existence_errors = "ENABLED"`, add:

```hcl

  # The ID token is what Verified Permissions checks, so its lifetime is how long
  # a removed member keeps access. The refresh token matches the old 7-day session.
  id_token_validity       = 15
  access_token_validity   = 15
  refresh_token_validity  = 7
  enable_token_revocation = true

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
```

- [ ] **Step 3: Format and validate**

```bash
cd /e/Personal/looper/infra/shared
terraform fmt && terraform validate
```

A local `terraform plan -var-file=terraform.tfvars` (with `AWS_PROFILE=personal`) is a quick preview if you want one; the plan that counts is the one CI posts on the PR.

- [ ] **Step 4: Commit, PR, read the plan**

```bash
cd /e/Personal/looper
git add infra/shared/access.tf infra/shared/auth.tf
git commit -m "feat(infra): Verified Permissions policy store and Cognito groups (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/access-control-store
gh pr create --base dev --title "feat(infra): Verified Permissions policy store and Cognito groups (#300)" --body "$(cat <<'EOF'
Part 1a of #300 (plan: docs/superpowers/plans/2026-09-29-access-control-authorization.md, Tasks 1-2).

- Cedar schema and four policies under infra/shared/cedar, tested offline with cedar-wasm
- Verified Permissions policy store (STRICT), schema, policies and Cognito identity source
- Cognito groups owner and friends, with the owner user in owner
- ID and access tokens 15 minutes, refresh token 7 days
- IsAuthorizedWithToken on both Vercel roles; AVP_POLICY_STORE_ID for production and preview

Nothing reads the new env var yet. The shorter tokens don't affect the current session cookie, which the callback issues after checking the ID token once.

Refs #300
EOF
)"
```

The `Terraform` workflow's plan for `shared` must show about `12 to add, 1 to change, 0 to destroy`: the store, the schema, 4 policies, the identity source, 2 groups, the group membership, 2 IAM policies and the env var; the change is `aws_cognito_user_pool_client.web`, updated in place. The env stacks show `No changes`. Stop and investigate anything marked `-/+` or `destroy`.

- [ ] **Step 5: Merge and wait for the apply**

Invoke the `merging-a-pr` skill and merge. The push to `dev` applies `shared`; wait for it:

```bash
gh run list --workflow terraform.yml --branch dev --limit 1
gh run watch <id> --exit-status
```

If `aws_cognito_user_in_group.owner` fails with `UserNotFoundException`, the admin API didn't accept the email alias. Read the stored username (a UUID) with `aws cognito-idp list-users --user-pool-id us-east-1_TagY3QxyT --filter 'email = "<alert_email>"' --query 'Users[0].Username' --output text --profile personal --region us-east-1`, set `username` to that literal with a comment saying the pool stores a UUID and the admin API didn't accept the email alias here, and fix it forward in a new PR.

- [ ] **Step 6: Check the result against the API**

```bash
cd /e/Personal/looper
STORE=$(aws verifiedpermissions list-policy-stores --profile personal --region us-east-1 --query 'policyStores[0].policyStoreId' --output text)
aws verifiedpermissions list-policies --policy-store-id "$STORE" --profile personal --region us-east-1 --query 'length(policies)'
aws cognito-idp admin-list-groups-for-user --user-pool-id us-east-1_TagY3QxyT --username "$(grep alert_email infra/shared/terraform.tfvars | cut -d'"' -f2)" --profile personal --region us-east-1 --query 'Groups[].GroupName'
```

Expected: `4`; `["owner"]`.

---

### Task 3: Spike — AWS credentials inside `proxy.ts`

Every check in this plan runs in `proxy.ts`, and the Vercel OIDC credentials have only ever been used from route handlers. Prove they work in the proxy before building on it. The code in this task is thrown away.

**Files:**
- Modify (temporarily): `web/proxy.ts`

- [ ] **Step 1: Branch, then add the probe**

Start the web PR's branch from `dev` after Task 2's PR merged and its apply finished:

```bash
cd /e/Personal/looper && git switch dev && git pull && git switch -c feat/access-control-core
```

At the top of `proxy()` in `web/proxy.ts`, before the `isGatedPath` check, add:

```ts
  if (request.nextUrl.pathname === "/api/authz-spike") {
    const out: Record<string, unknown> = {
      oidcHeader: request.headers.has("x-vercel-oidc-token"),
      oidcEnv: Boolean(process.env.VERCEL_OIDC_TOKEN),
    };
    try {
      const { awsCredentialsProvider } = await import("@vercel/oidc-aws-credentials-provider");
      const creds = await awsCredentialsProvider({ roleArn: process.env.APP_AWS_ROLE_ARN! })();
      out.provider = `ok ${creds.accessKeyId.slice(0, 4)}`;
    } catch (err) {
      out.provider = String(err);
    }
    return NextResponse.json(out);
  }
```

and make the function `async` (`export async function proxy(request: NextRequest)`).

- [ ] **Step 2: Push and read the probe on the branch's preview deployment**

```bash
cd /e/Personal/looper
git add web/proxy.ts && git commit -m "chore: probe AWS credentials in the proxy (temporary)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/access-control-core
```

Wait for the Vercel preview (`gh pr checks` isn't available without a PR; use `vercel ls` or the GitHub commit status). Then open `https://bgm-looper-git-feat-access-control-core-ashutosh-pandeys-projects-77cb3a00.vercel.app/api/authz-spike`.

- [ ] **Step 3: Decide**

- `provider: "ok ASIA"`: the design stands. Continue with Task 4.
- `provider` is an error but `oidcHeader` or `oidcEnv` is `true`: stop and report to the owner. The token is there but the provider can't read it in the proxy; the fix is a small credential provider that reads the header, which needs a decision.
- All three false or failing: stop and report to the owner. The fallback (spec §11) is to run the checks in a shared `authorize()` called from each gated route handler and each gated page's layout, with the same `ROUTE_ACTIONS` table. That changes Tasks 8 and 9, so it needs the owner's go-ahead.

- [ ] **Step 4: Remove the probe**

```bash
git revert --no-edit HEAD
git commit --amend -m "chore: remove the proxy credentials probe" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push
```

Record the probe's JSON output in the PR description later.

---

### Task 4: Encrypted token session

**Files:**
- Modify: `web/lib/auth.ts` (add the new session; the old timestamp functions stay until Task 6)
- Test: `web/lib/auth.test.ts` (add a new `describe` block per function)

**Interfaces:**
- Produces:
  - `ID_COOKIE = "site_id"`, `REFRESH_COOKIE = "site_refresh"`, `SESSION_MAX_AGE_S = 604800`
  - `seal(plaintext: string, secret: string): string` and `unseal(sealed: string | undefined, secret: string): string | null`
  - `decodeClaims(jwt: string): Record<string, unknown> | null`
  - `type Session = { idToken: string; refreshToken: string | null; sub: string; email: string | null; groups: string[]; expiresAt: number }` (`expiresAt` is the ID token's `exp`, epoch seconds)
  - `sessionFromTokens(idToken: string, refreshToken: string | null): Session | null`
  - `readSession(cookies: { get(name: string): { value: string } | undefined }, secret: string): Session | null`
  - `setSessionCookies(response: { cookies: { set(name: string, value: string, options: object): unknown } }, tokens: { idToken: string; refreshToken?: string }, secret: string): void`
  - `clearSessionCookies(response: same type): void`

- [ ] **Step 1: Write the failing tests**

Append to `web/lib/auth.test.ts`:

```ts
import {
  clearSessionCookies,
  decodeClaims,
  ID_COOKIE,
  readSession,
  REFRESH_COOKIE,
  seal,
  sessionFromTokens,
  setSessionCookies,
  unseal,
} from "./auth";

const jwt = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

function jar(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { value: values[name] } : undefined) };
}

function recorder() {
  const set: Record<string, { value: string; options: Record<string, unknown> }> = {};
  return {
    set,
    response: { cookies: { set: (name: string, value: string, options: object) => { set[name] = { value, options: options as Record<string, unknown> }; } } },
  };
}

describe("seal / unseal", () => {
  it("round-trips", () => {
    expect(unseal(seal("hello", "s1"), "s1")).toBe("hello");
  });

  it("produces a different ciphertext each time", () => {
    expect(seal("hello", "s1")).not.toBe(seal("hello", "s1"));
  });

  it.each([
    ["wrong secret", (v: string) => ({ value: v, secret: "s2" })],
    ["one changed character", (v: string) => ({ value: (v[5] === "A" ? "B" : "A") + v.slice(1), secret: "s1" })],
    ["truncated", (v: string) => ({ value: v.slice(0, 20), secret: "s1" })],
    ["not base64", () => ({ value: "!!!", secret: "s1" })],
    ["empty", () => ({ value: "", secret: "s1" })],
  ])("rejects %s", (_label, mutate) => {
    const { value, secret } = mutate(seal("hello", "s1"));
    expect(unseal(value, secret)).toBeNull();
  });

  it("returns null for a missing cookie", () => {
    expect(unseal(undefined, "s1")).toBeNull();
  });
});

describe("decodeClaims", () => {
  it("reads the payload", () => {
    expect(decodeClaims(jwt({ sub: "u1" }))).toEqual({ sub: "u1" });
  });

  it.each(["", "abc", "a.!!!.c", `a.${Buffer.from("[1]").toString("base64url")}.c`])("returns null for %j", (value) => {
    expect(decodeClaims(value)).toBeNull();
  });
});

describe("sessionFromTokens", () => {
  it("reads sub, email, groups and exp", () => {
    const token = jwt({ sub: "u1", email: "a@example.com", exp: 100, "cognito:groups": ["friends", "us-east-1_x_Google"] });
    expect(sessionFromTokens(token, "rt")).toEqual({
      idToken: token,
      refreshToken: "rt",
      sub: "u1",
      email: "a@example.com",
      groups: ["friends", "us-east-1_x_Google"],
      expiresAt: 100,
    });
  });

  // A first-time Google user is in no group yet: the claim is absent, not empty.
  it("treats a missing cognito:groups claim as no groups", () => {
    expect(sessionFromTokens(jwt({ sub: "u1", exp: 100 }), null)?.groups).toEqual([]);
  });

  it("drops non-string group entries", () => {
    expect(sessionFromTokens(jwt({ sub: "u1", exp: 100, "cognito:groups": ["owner", 7] }), null)?.groups).toEqual(["owner"]);
  });

  it.each([{ exp: 100 }, { sub: "u1" }, { sub: 5, exp: 100 }])("returns null without a string sub and a numeric exp: %j", (claims) => {
    expect(sessionFromTokens(jwt(claims), null)).toBeNull();
  });
});

describe("readSession", () => {
  const token = jwt({ sub: "u1", exp: 100 });

  it("opens both cookies", () => {
    const session = readSession(jar({ [ID_COOKIE]: seal(token, "s1"), [REFRESH_COOKIE]: seal("rt", "s1") }), "s1");
    expect(session).toMatchObject({ idToken: token, refreshToken: "rt", sub: "u1" });
  });

  it("works without a refresh cookie", () => {
    expect(readSession(jar({ [ID_COOKIE]: seal(token, "s1") }), "s1")?.refreshToken).toBeNull();
  });

  it("returns null without an ID cookie, or with one sealed under another secret", () => {
    expect(readSession(jar({}), "s1")).toBeNull();
    expect(readSession(jar({ [ID_COOKIE]: seal(token, "other") }), "s1")).toBeNull();
  });
});

describe("setSessionCookies / clearSessionCookies", () => {
  it("sets both cookies sealed, httpOnly, secure, lax, path /, 7 days", () => {
    const { set, response } = recorder();
    setSessionCookies(response, { idToken: "id", refreshToken: "rt" }, "s1");
    expect(unseal(set[ID_COOKIE].value, "s1")).toBe("id");
    expect(unseal(set[REFRESH_COOKIE].value, "s1")).toBe("rt");
    for (const name of [ID_COOKIE, REFRESH_COOKIE]) {
      expect(set[name].options).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 604800 });
    }
  });

  it("leaves the refresh cookie alone when only the ID token changes", () => {
    const { set, response } = recorder();
    setSessionCookies(response, { idToken: "id" }, "s1");
    expect(Object.keys(set)).toEqual([ID_COOKIE]);
  });

  it("clears both", () => {
    const { set, response } = recorder();
    clearSessionCookies(response);
    expect(set[ID_COOKIE]).toMatchObject({ value: "", options: { maxAge: 0, path: "/" } });
    expect(set[REFRESH_COOKIE]).toMatchObject({ value: "", options: { maxAge: 0, path: "/" } });
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd web && npx vitest run lib/auth.test.ts`
Expected: FAIL, `seal` is not exported.

- [ ] **Step 3: Implement**

Append to `web/lib/auth.ts` (and add `createCipheriv, createDecipheriv, hkdfSync, randomBytes` to its `crypto` import):

```ts
// --- Token session (spec 2026-09-29-access-control-design.md §5) ---
//
// The session is the user's Cognito tokens: Verified Permissions needs the ID
// token for every decision, and the refresh token renews it every 15 minutes.
// The refresh token is a credential, so both cookies are encrypted, not only
// signed. Two cookies because together they come close to the 4 KB limit.

export const ID_COOKIE = "site_id";
export const REFRESH_COOKIE = "site_refresh";
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

function sessionKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", "site-session-v1", 32));
}

/** AES-256-GCM, as base64url(iv | tag | ciphertext). */
export function seal(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal(sealed: string | undefined, secret: string): string | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** A JWT's payload, unverified. Only used on tokens that were verified before
 * they were sealed, so the cookie's encryption is what vouches for them. */
export function decodeClaims(jwt: string): Record<string, unknown> | null {
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export type Session = {
  idToken: string;
  refreshToken: string | null;
  sub: string;
  email: string | null;
  /** Cognito group names, without the pool prefix. Empty for a user in none. */
  groups: string[];
  /** The ID token's exp, in epoch seconds. */
  expiresAt: number;
};

export function sessionFromTokens(idToken: string, refreshToken: string | null): Session | null {
  const claims = decodeClaims(idToken);
  if (!claims || typeof claims.sub !== "string" || typeof claims.exp !== "number") return null;
  const rawGroups = claims["cognito:groups"];
  const groups = Array.isArray(rawGroups) ? rawGroups.filter((g): g is string => typeof g === "string") : [];
  return {
    idToken,
    refreshToken,
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    groups,
    expiresAt: claims.exp,
  };
}

type CookieReader = { get(name: string): { value: string } | undefined };
type CookieWriter = { cookies: { set(name: string, value: string, options: object): unknown } };

export function readSession(cookies: CookieReader, secret: string): Session | null {
  const idToken = unseal(cookies.get(ID_COOKIE)?.value, secret);
  if (!idToken) return null;
  return sessionFromTokens(idToken, unseal(cookies.get(REFRESH_COOKIE)?.value, secret));
}

const SESSION_COOKIE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

export function setSessionCookies(
  response: CookieWriter,
  tokens: { idToken: string; refreshToken?: string },
  secret: string,
): void {
  response.cookies.set(ID_COOKIE, seal(tokens.idToken, secret), { ...SESSION_COOKIE, maxAge: SESSION_MAX_AGE_S });
  if (tokens.refreshToken) {
    response.cookies.set(REFRESH_COOKIE, seal(tokens.refreshToken, secret), { ...SESSION_COOKIE, maxAge: SESSION_MAX_AGE_S });
  }
}

export function clearSessionCookies(response: CookieWriter): void {
  response.cookies.set(ID_COOKIE, "", { ...SESSION_COOKIE, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...SESSION_COOKIE, maxAge: 0 });
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run lib/auth.test.ts`
Expected: PASS (old and new blocks).

- [ ] **Step 5: Commit**

```bash
git add web/lib/auth.ts web/lib/auth.test.ts
git commit -m "feat(auth): encrypted token session cookies (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 5: `ROUTE_ACTIONS` and tool IDs in `route-gate.ts`

**Files:**
- Modify: `web/lib/route-gate.ts`
- Test: `web/lib/route-gate.test.ts` (add blocks), `web/lib/route-coverage.test.ts` (new)

**Interfaces:**
- Produces:
  - `type ToolId = "hub" | "bgm-looper" | "money-planner" | "news-desk" | "resume-admin" | "newsletter-admin" | "keystatic" | "access-admin"`
  - `METERED_ACTIONS` (readonly tuple) and `type MeteredAction`
  - `type ActionId` (all twelve)
  - `type RouteAction = { tool: ToolId; action: ActionId; consumes: boolean }`
  - `actionFor(method: string, pathname: string): RouteAction | null`
  - `isMetered(action: ActionId): action is MeteredAction`
  - `Tool` gains `id: ToolId` and `pageAction: ActionId`

- [ ] **Step 1: Write the failing mapping tests**

Append to `web/lib/route-gate.test.ts` (and add `actionFor, isMetered` to its import):

```ts
describe("actionFor", () => {
  it.each([
    ["GET", "/tools", "hub", "view", false],
    ["GET", "/tools/bgm-looper", "bgm-looper", "view", false],
    ["POST", "/api/looper/upload-url", "bgm-looper", "looper:process", false],
    ["POST", "/api/looper/process", "bgm-looper", "looper:process", true],
    ["GET", "/tools/money-planner", "money-planner", "view", false],
    ["GET", "/tools/news-desk", "news-desk", "view", false],
    ["POST", "/api/news-desk/indicators", "news-desk", "newsdesk:pin", false],
    ["DELETE", "/api/news-desk/indicators/cpi-food", "news-desk", "newsdesk:pin", false],
    ["POST", "/api/news-desk/refresh", "news-desk", "newsdesk:refresh", true],
    ["POST", "/api/news-desk/ask", "news-desk", "newsdesk:ask", true],
    ["GET", "/tools/resume-admin", "resume-admin", "view", false],
    ["GET", "/tools/resume-admin/preview/abc123", "resume-admin", "view", false],
    ["GET", "/api/resume/draft", "resume-admin", "resume:draft", false],
    ["PUT", "/api/resume/draft", "resume-admin", "resume:draft", false],
    ["POST", "/api/resume/upload-url", "resume-admin", "resume:draft", false],
    ["POST", "/api/resume/extract", "resume-admin", "resume:extract", false],
    ["POST", "/api/resume/publish", "resume-admin", "resume:publish", false],
    ["GET", "/tools/newsletter-admin", "newsletter-admin", "view", false],
    ["POST", "/api/newsletter/send", "newsletter-admin", "newsletter:send", false],
    ["GET", "/keystatic", "keystatic", "keystatic:use", false],
    ["GET", "/keystatic/blog/hello", "keystatic", "keystatic:use", false],
    ["POST", "/api/keystatic/github/oauth/callback", "keystatic", "keystatic:use", false],
  ])("%s %s -> %s %s (consumes: %s)", (method, path, tool, action, consumes) => {
    expect(actionFor(method, path)).toEqual({ tool, action, consumes });
  });

  it("treats HEAD like GET and ignores a trailing slash", () => {
    expect(actionFor("HEAD", "/tools/news-desk")).toEqual({ tool: "news-desk", action: "view", consumes: false });
    expect(actionFor("GET", "/tools/news-desk/")).toEqual({ tool: "news-desk", action: "view", consumes: false });
    expect(actionFor("get", "/tools")).toEqual({ tool: "hub", action: "view", consumes: false });
  });

  it.each([
    ["POST", "/tools/news-desk"],
    ["GET", "/api/news-desk/ask"],
    ["DELETE", "/api/news-desk/indicators"],
    ["GET", "/tools/something-new"],
    ["GET", "/api/looper/anything"],
  ])("leaves %s %s unmapped, so the proxy denies it", (method, path) => {
    expect(actionFor(method, path)).toBeNull();
  });
});

describe("isMetered", () => {
  it("is true for exactly the three metered actions", () => {
    expect(["looper:process", "newsdesk:refresh", "newsdesk:ask"].every((a) => isMetered(a as never))).toBe(true);
    expect(isMetered("view")).toBe(false);
    expect(isMetered("resume:extract")).toBe(false);
  });
});

describe("TOOLS", () => {
  it("gives every tool the action its page needs", () => {
    for (const tool of TOOLS) {
      expect(actionFor("GET", tool.href)).toMatchObject({ tool: tool.id, action: tool.pageAction });
    }
  });
});
```

- [ ] **Step 2: Write the failing coverage test**

`web/lib/route-coverage.test.ts`:

```ts
// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { actionFor, isGatedPath } from "./route-gate";

const APP = path.resolve(__dirname, "..", "app");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** app/api/x/[id]/route.ts -> /api/x/sample; route groups "(site)" vanish;
 * [...a] becomes two segments and [[...a]] becomes none. */
function urlFor(file: string): string {
  const segments = path
    .relative(APP, path.dirname(file))
    .split(path.sep)
    .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")))
    .flatMap((s) => {
      if (s.startsWith("[[...")) return [];
      if (s.startsWith("[...")) return ["a", "b"];
      if (s.startsWith("[")) return ["sample"];
      return [s];
    });
  return "/" + segments.join("/");
}

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

function methodsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return METHODS.filter((m) =>
    new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b|export\\s+const\\s+\\{[^}]*\\b${m}\\b[^}]*\\}`).test(source),
  );
}

const files = walk(APP);
const gatedRoutes = files
  .filter((f) => f.endsWith(`${path.sep}route.ts`))
  .map((f) => ({ url: urlFor(f), methods: methodsOf(f), file: path.relative(APP, f) }))
  .filter((r) => isGatedPath(r.url));
const gatedPages = files
  .filter((f) => f.endsWith(`${path.sep}page.tsx`))
  .map((f) => ({ url: urlFor(f), file: path.relative(APP, f) }))
  .filter((p) => isGatedPath(p.url));

describe("every gated route has an action", () => {
  it("finds the gated routes and pages", () => {
    expect(gatedRoutes.length).toBeGreaterThan(10);
    expect(gatedPages.length).toBeGreaterThan(5);
  });

  it.each(gatedRoutes.flatMap((r) => r.methods.map((m) => [m, r.url, r.file])))("%s %s (%s)", (method, url) => {
    expect(actionFor(method, url)).not.toBeNull();
  });

  it.each(gatedPages.map((p) => [p.url, p.file]))("GET %s (%s)", (url) => {
    expect(actionFor("GET", url)).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd web && npx vitest run lib/route-gate.test.ts lib/route-coverage.test.ts`
Expected: FAIL, `actionFor` is not exported.

- [ ] **Step 4: Implement**

In `web/lib/route-gate.ts`, replace the `Tool` type and the `TOOLS` array's entries to carry the two new fields, and add the mapping. The full new top of the file, up to `GATED_PREFIXES`:

```ts
export type ToolId =
  | "hub"
  | "bgm-looper"
  | "money-planner"
  | "news-desk"
  | "resume-admin"
  | "newsletter-admin"
  | "keystatic"
  | "access-admin";

// The actions Verified Permissions decides on. The Cedar schema in
// infra/shared/cedar/ declares the same twelve; the policy tests fail if they drift.
export const METERED_ACTIONS = ["looper:process", "newsdesk:refresh", "newsdesk:ask"] as const;
export type MeteredAction = (typeof METERED_ACTIONS)[number];
export type ActionId =
  | "view"
  | "newsdesk:pin"
  | MeteredAction
  | "resume:draft"
  | "resume:extract"
  | "resume:publish"
  | "newsletter:send"
  | "keystatic:use"
  | "access:manage";

export function isMetered(action: ActionId): action is MeteredAction {
  return (METERED_ACTIONS as readonly string[]).includes(action);
}

// Every tool the hub lists, in the order it lists them. Three consumers: the
// /tools hub renders a row per entry the viewer may open, the login page's
// "Continuing to → X" strip names the destination from it, and the command bar
// gets an `open <tool>` row per entry. Adding a tool is one entry here, one row
// in ROUTE_ACTIONS below, and the action in the Cedar schema.
export type Tool = {
  id: ToolId;
  href: string;
  name: string;
  kind: string;
  blurb: string;
  /** What opening the page needs; the hub checks it to decide what to list. */
  pageAction: ActionId;
};

export const TOOLS: Tool[] = [
  {
    id: "bgm-looper",
    href: "/tools/bgm-looper",
    name: "BGM Looper",
    kind: "Audio",
    blurb:
      "Find the seamless loop point in a track, crossfade the seam, normalize to −14 LUFS.",
    pageAction: "view",
  },
  {
    id: "resume-admin",
    href: "/tools/resume-admin",
    name: "Resume admin",
    kind: "Site",
    blurb:
      "Upload a resume PDF, check what was read out of it, publish it to the public page.",
    pageAction: "view",
  },
  {
    id: "newsletter-admin",
    href: "/tools/newsletter-admin",
    name: "Newsletter admin",
    kind: "Site",
    blurb:
      "Review an archived newsletter issue and send it to subscribers through Buttondown.",
    pageAction: "view",
  },
  {
    id: "money-planner",
    href: "/tools/money-planner",
    name: "Money Planner",
    kind: "Money",
    blurb:
      "Work out the date a purchase becomes affordable, from a balance, a salary and expenses on their own cadences.",
    pageAction: "view",
  },
  {
    id: "news-desk",
    href: "/tools/news-desk",
    name: "News Desk",
    kind: "News",
    blurb:
      "Headlines on the Indian economy, reforms and legislation from 13 free sources, refreshed when you ask.",
    pageAction: "view",
  },
  {
    id: "keystatic",
    href: "/keystatic",
    name: "Content editor",
    kind: "Site",
    blurb:
      "Write and edit blog posts and newsletter issues. Commits straight to the repo through Keystatic.",
    pageAction: "keystatic:use",
  },
];

export type RouteAction = { tool: ToolId; action: ActionId; consumes: boolean };

type Rule = {
  methods: readonly string[] | "*";
  path: RegExp;
  tool: ToolId;
  action: ActionId;
  /** Takes one use from a metered grant. The looper's upload URL is checked
   * against the grant but doesn't consume it, so a run costs one use. */
  consumes?: boolean;
};

const PAGE = ["GET", "HEAD"] as const;

// Every gated (method, path) and what it needs. A gated request that matches
// nothing here is denied; route-coverage.test.ts fails for any gated route.ts or
// page.tsx without a row.
const ROUTE_ACTIONS: Rule[] = [
  { methods: PAGE, path: /^\/tools$/, tool: "hub", action: "view" },
  { methods: PAGE, path: /^\/tools\/bgm-looper$/, tool: "bgm-looper", action: "view" },
  { methods: ["POST"], path: /^\/api\/looper\/upload-url$/, tool: "bgm-looper", action: "looper:process" },
  { methods: ["POST"], path: /^\/api\/looper\/process$/, tool: "bgm-looper", action: "looper:process", consumes: true },
  { methods: PAGE, path: /^\/tools\/money-planner$/, tool: "money-planner", action: "view" },
  { methods: PAGE, path: /^\/tools\/news-desk$/, tool: "news-desk", action: "view" },
  { methods: ["POST"], path: /^\/api\/news-desk\/indicators$/, tool: "news-desk", action: "newsdesk:pin" },
  { methods: ["DELETE"], path: /^\/api\/news-desk\/indicators\/[^/]+$/, tool: "news-desk", action: "newsdesk:pin" },
  { methods: ["POST"], path: /^\/api\/news-desk\/refresh$/, tool: "news-desk", action: "newsdesk:refresh", consumes: true },
  { methods: ["POST"], path: /^\/api\/news-desk\/ask$/, tool: "news-desk", action: "newsdesk:ask", consumes: true },
  { methods: PAGE, path: /^\/tools\/resume-admin(\/preview\/[^/]+)?$/, tool: "resume-admin", action: "view" },
  { methods: ["GET", "PUT"], path: /^\/api\/resume\/draft$/, tool: "resume-admin", action: "resume:draft" },
  { methods: ["POST"], path: /^\/api\/resume\/upload-url$/, tool: "resume-admin", action: "resume:draft" },
  { methods: ["POST"], path: /^\/api\/resume\/extract$/, tool: "resume-admin", action: "resume:extract" },
  { methods: ["POST"], path: /^\/api\/resume\/publish$/, tool: "resume-admin", action: "resume:publish" },
  { methods: PAGE, path: /^\/tools\/newsletter-admin$/, tool: "newsletter-admin", action: "view" },
  { methods: ["POST"], path: /^\/api\/newsletter\/send$/, tool: "newsletter-admin", action: "newsletter:send" },
  { methods: "*", path: /^\/(api\/)?keystatic(\/.*)?$/, tool: "keystatic", action: "keystatic:use" },
];

export function actionFor(method: string, pathname: string): RouteAction | null {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const verb = method.toUpperCase();
  const rule = ROUTE_ACTIONS.find(
    (r) => (r.methods === "*" || r.methods.includes(verb)) && r.path.test(path),
  );
  return rule ? { tool: rule.tool, action: rule.action, consumes: rule.consumes ?? false } : null;
}
```

Keep the existing `GATED_PREFIXES`, `ALWAYS_ALLOWED_PATHS`, `TOOL_NAMES`, `matches`, `isGatedPath` and `toolNameFor` as they are.

- [ ] **Step 5: Run the tests**

Run: `cd web && npx vitest run lib/route-gate.test.ts lib/route-coverage.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors (the hub and login page only read fields that still exist).

- [ ] **Step 6: Commit**

```bash
git add web/lib/route-gate.ts web/lib/route-gate.test.ts web/lib/route-coverage.test.ts
git commit -m "feat(access): map every gated route to a tool and action (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 6: Callback issues the token session; refresh helper

**Files:**
- Modify: `web/lib/cognito.ts`, `web/lib/cognito.test.ts`
- Modify: `web/app/api/auth/callback/route.ts`, `web/app/api/auth/callback/route.test.ts`
- Modify: `web/lib/auth.ts`, `web/lib/auth.test.ts` (remove the timestamp session)
- Modify: `web/app/login/page.tsx`, `web/app/login/page.test.tsx` (drop the `not-allowed` message)

**Interfaces:**
- Consumes: `setSessionCookies` (Task 4).
- Produces: `type Tokens = { idToken: string; refreshToken: string }`; `exchangeCode(p): Promise<Tokens>`; `refreshIdToken(refreshToken: string): Promise<string>`; `verifyIdToken(idToken: string, verifier?: IdTokenVerifier): Promise<boolean>`. `isOwner`, `COOKIE_NAME`, `createSessionCookieValue`, `verifySessionCookieValue` and `SESSION_MAX_AGE_MS` are removed.

`app/api/auth/passkey/route.ts` needs no change: it never read the session cookie.

- [ ] **Step 1: Update the Cognito tests**

In `web/lib/cognito.test.ts`:
- change the import to `import { authorizeUrl, exchangeCode, pkcePair, refreshIdToken, safeNext, verifyIdToken } from "./cognito";`
- delete `process.env.OWNER_EMAIL = …` from `beforeEach`
- in the first `exchangeCode` test, change the mocked JSON to `({ id_token: "idtok", refresh_token: "rt" })` and the assertion to `expect(await exchangeCode(...)).toEqual({ idToken: "idtok", refreshToken: "rt" })`
- replace the whole `describe("isOwner", …)` block with:

```ts
describe("exchangeCode", () => {
  it("throws when Cognito returns no refresh token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id_token: "idtok" }) })));
    await expect(exchangeCode({ code: "c", verifier: "v", redirectUri: "r" })).rejects.toThrow("no tokens");
  });
});

describe("refreshIdToken", () => {
  it("posts the refresh token and returns the new ID token", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id_token: "new" }) }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshIdToken("rt")).toBe("new");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://login.example.com/oauth2/token");
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      grant_type: "refresh_token",
      client_id: "client123",
      refresh_token: "rt",
    });
  });

  it("throws when Cognito refuses the refresh token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })));
    await expect(refreshIdToken("rt")).rejects.toThrow("400");
  });
});

describe("verifyIdToken", () => {
  it("is true when the verifier accepts the token", async () => {
    expect(await verifyIdToken("t", { verify: vi.fn(async () => ({ sub: "u" })) })).toBe(true);
  });

  it("is false when it throws", async () => {
    expect(await verifyIdToken("t", { verify: vi.fn(async () => { throw new Error("bad sig"); }) })).toBe(false);
  });
});
```

- [ ] **Step 2: Update the callback tests**

In `web/app/api/auth/callback/route.test.ts`:
- mock `verifyIdToken` instead of `isOwner` (in `vi.mock` and the import)
- replace `import { COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth";` with `import { ID_COOKIE, REFRESH_COOKIE, unseal } from "@/lib/auth";`
- replace every `res.cookies.get(COOKIE_NAME)` with `res.cookies.get(ID_COOKIE)`
- change the first test to:

```ts
  it("signs any verified user in and sends them where they were going", async () => {
    vi.mocked(exchangeCode).mockResolvedValue({ idToken: "idtok", refreshToken: "rt" });
    vi.mocked(verifyIdToken).mockResolvedValue(true);

    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));

    expect(redirectedTo(res)).toBe("/tools/news-desk");
    expect(exchangeCode).toHaveBeenCalledWith({
      code: "c",
      verifier: "ver",
      redirectUri: "https://site.example/api/auth/callback",
    });
    expect(verifyIdToken).toHaveBeenCalledWith("idtok");
    expect(unseal(res.cookies.get(ID_COOKIE)!.value, "secret")).toBe("idtok");
    expect(unseal(res.cookies.get(REFRESH_COOKIE)!.value, "secret")).toBe("rt");
    expect(res.cookies.get(OAUTH_COOKIE)!.value).toBe("");
  });
```

- replace the `"refuses anyone but the owner"` and `"redirects rather than failing when the owner check throws"` tests with:

```ts
  it("refuses a token that fails verification", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(exchangeCode).mockResolvedValue({ idToken: "idtok", refreshToken: "rt" });
    vi.mocked(verifyIdToken).mockResolvedValue(false);

    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=failed");
    expect(res.cookies.get(ID_COOKIE)).toBeUndefined();
  });
```

- [ ] **Step 3: Run to see them fail**

Run: `cd web && npx vitest run lib/cognito.test.ts app/api/auth/callback`
Expected: FAIL, `refreshIdToken`/`verifyIdToken` not exported.

- [ ] **Step 4: Implement in `lib/cognito.ts`**

Replace `exchangeCode`, `defaultVerifier` and `isOwner` with:

```ts
export type Tokens = { idToken: string; refreshToken: string };

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${process.env.COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.COGNITO_CLIENT_ID!, ...params }).toString(),
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return res.json();
}

/** Trades the authorization code for tokens. Public client: the PKCE verifier
 * stands in for a client secret. */
export async function exchangeCode(p: { code: string; verifier: string; redirectUri: string }): Promise<Tokens> {
  const body = await tokenRequest({
    grant_type: "authorization_code",
    code: p.code,
    redirect_uri: p.redirectUri,
    code_verifier: p.verifier,
  });
  if (typeof body.id_token !== "string" || typeof body.refresh_token !== "string") {
    throw new Error("token exchange returned no tokens");
  }
  return { idToken: body.id_token, refreshToken: body.refresh_token };
}

/** A new ID token for a refresh token. Cognito doesn't rotate refresh tokens
 * for this client, so the refresh cookie stays as it is. */
export async function refreshIdToken(refreshToken: string): Promise<string> {
  const body = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (typeof body.id_token !== "string") throw new Error("token refresh returned no ID token");
  return body.id_token;
}

export type IdTokenVerifier = { verify(token: string): Promise<Record<string, unknown>> };

let verifier: IdTokenVerifier | null = null;

// One instance per process, so the pool's JWKS is fetched once and cached.
function defaultVerifier(): IdTokenVerifier {
  // Checks signature (against the pool's JWKS), issuer, audience, token_use and expiry.
  return (verifier ??= CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    tokenUse: "id",
    clientId: process.env.COGNITO_CLIENT_ID!,
  }) as unknown as IdTokenVerifier);
}

/** Whether a token really came from this pool and client and hasn't expired.
 * Who may do what is Verified Permissions' decision, not this one. */
export async function verifyIdToken(idToken: string, v: IdTokenVerifier = defaultVerifier()): Promise<boolean> {
  try {
    await v.verify(idToken);
    return true;
  } catch {
    return false;
  }
}
```

The existing `exchangeCode` test asserts the exact request body; `tokenRequest` puts `client_id` first and the rest after, which `Object.fromEntries` compares without regard to order, so it still passes.

- [ ] **Step 5: Implement in the callback**

In `web/app/api/auth/callback/route.ts`:
- imports: `import { setSessionCookies } from "@/lib/auth";` and `import { exchangeCode, safeNext, verifyIdToken, type Tokens } from "@/lib/cognito";`
- replace `let idToken: string; try { idToken = await exchangeCode(…) }` with `let tokens: Tokens; try { tokens = await exchangeCode(…) }`
- replace everything from `let owner: boolean;` to the end of the function with:

```ts
  if (!(await verifyIdToken(tokens.idToken))) {
    console.error("auth: the ID token from the code exchange failed verification");
    return toLogin(request, "failed");
  }

  // saved.next was cleaned by the login route and is signed, but this is the
  // redirect that matters, so it is cleaned again here. Any Cognito user gets a
  // session; the proxy asks Verified Permissions what the session may open.
  const response = NextResponse.redirect(new URL(safeNext(saved.next), request.url));
  response.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  setSessionCookies(response, tokens, secret);
  return response;
}
```

- [ ] **Step 6: Remove the timestamp session**

In `web/lib/auth.ts` delete `COOKIE_NAME`, `sign`, `SESSION_MAX_AGE_MS`, `createSessionCookieValue` and `verifySessionCookieValue`, the comment above them, and the now-unused `createHmac, timingSafeEqual` imports. In `web/lib/auth.test.ts` delete the tests for those functions. Leave `proxy.ts` alone for now; it still imports them and will fail type-checking until Task 8, so don't run `tsc` in this task.

- [ ] **Step 7: Drop the login page's `not-allowed` message**

Nothing sends `?error=not-allowed` any more. Delete the `"not-allowed": …` entry from `ERRORS` in `web/app/login/page.tsx` and the `["not-allowed", …]` row in `web/app/login/page.test.tsx`.

- [ ] **Step 8: Run the tests**

Run: `cd web && npx vitest run lib/cognito.test.ts lib/auth.test.ts app/api/auth app/login`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/lib/cognito.ts web/lib/cognito.test.ts web/lib/auth.ts web/lib/auth.test.ts web/app/api/auth/callback web/app/login
git commit -m "feat(auth): sign in any Cognito user with a token session (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 7: Authorizers — Verified Permissions, local Cedar, and the guard

**Files:**
- Create: `web/lib/authz/authorizer.ts`, `web/lib/authz/avp.ts`, `web/lib/authz/local.ts`
- Test: `web/lib/authz/authorizer.test.ts`, `web/lib/authz/avp.test.ts`, `web/lib/authz/local.test.ts`
- Modify: `web/package.json` (dependencies), `web/next.config.mjs`

**Interfaces:**
- Consumes: `Session` (Task 4), `ToolId`, `ActionId` (Task 5), `loadCedar` (Task 1), `awsCredentials()` from `web/lib/aws.ts`.
- Produces:
  - `type AuthzContext = { now: number; grant?: { remaining: number; expiresAt: number } }`
  - `type AuthzRequest = { session: Session; tool: ToolId; action: ActionId; context: AuthzContext }`
  - `type Decision = "allow" | "deny"`
  - `interface Authorizer { isAuthorized(req: AuthzRequest): Promise<Decision> }` — throws when the decision can't be made (network, timeout, misconfiguration)
  - `getAuthorizer(env?: NodeJS.ProcessEnv): Authorizer`
  - `createAvpAuthorizer(policyStoreId: string): Authorizer`, `createLocalAuthorizer(poolId: string): Authorizer`

- [ ] **Step 1: Install dependencies**

```bash
cd web
npm install @aws-sdk/client-verifiedpermissions
npm install --save-dev aws-sdk-client-mock
```

- [ ] **Step 2: Write the failing tests**

`web/lib/authz/avp.test.ts`:

```ts
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
```

`web/lib/authz/local.test.ts`:

```ts
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
```

`web/lib/authz/authorizer.test.ts`:

```ts
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
```

- [ ] **Step 3: Run to see them fail**

Run: `cd web && npx vitest run lib/authz`
Expected: FAIL, modules not found (the Task 1 policy tests still pass).

- [ ] **Step 4: Implement**

`web/lib/authz/authorizer.ts`:

```ts
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
```

`web/lib/authz/avp.ts`:

```ts
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
```

`web/lib/authz/local.ts`:

```ts
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
```

`web/next.config.mjs`: add, as the first key of `nextConfig`,

```js
  // The local authorizer (e2e only) loads Cedar's WASM build at runtime; bundling
  // it breaks the .wasm file lookup.
  serverExternalPackages: ["@cedar-policy/cedar-wasm"],
```

- [ ] **Step 5: Run the tests**

Run: `cd web && npx vitest run lib/authz next.config`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/lib/authz web/package.json web/package-lock.json web/next.config.mjs
git commit -m "feat(access): Verified Permissions and local Cedar authorizers (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 8: The proxy decides every gated request

**Files:**
- Modify: `web/proxy.ts` (rewrite)
- Test: `web/proxy.test.ts` (rewrite)

**Interfaces:**
- Consumes: `readSession`, `sessionFromTokens`, `setSessionCookies`, `clearSessionCookies`, `seal`, `ID_COOKIE` (Task 4); `refreshIdToken`, `verifyIdToken` (Task 6); `actionFor`, `isGatedPath`, `isMetered`, `RouteAction` (Task 5); `getAuthorizer`, `AuthzContext` (Task 7).
- Produces: `proxy(request: NextRequest): Promise<NextResponse>`; `type Denial`. Part 2 adds the grant lookup at the marked place in `decide()`.

- [ ] **Step 1: Write the failing tests**

Replace `web/proxy.test.ts` with:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("./lib/cognito", () => ({ refreshIdToken: vi.fn(), verifyIdToken: vi.fn() }));
vi.mock("./lib/authz/authorizer", () => ({ getAuthorizer: vi.fn() }));

import { refreshIdToken, verifyIdToken } from "./lib/cognito";
import { getAuthorizer } from "./lib/authz/authorizer";
import { ID_COOKIE, REFRESH_COOKIE, seal, unseal } from "./lib/auth";
import { proxy } from "./proxy";

const SECRET = "secret";
const NOW_S = Math.floor(Date.now() / 1000);
const isAuthorized = vi.fn();

const jwt = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const token = (groups: string[] | null, exp = NOW_S + 900) =>
  jwt({ sub: "u1", exp, ...(groups ? { "cognito:groups": groups } : {}) });

function request(path: string, opts: { method?: string; idToken?: string; refreshToken?: string } = {}) {
  const req = new NextRequest(new URL(`https://site.example${path}`), { method: opts.method ?? "GET" });
  if (opts.idToken) req.cookies.set(ID_COOKIE, seal(opts.idToken, SECRET));
  if (opts.refreshToken) req.cookies.set(REFRESH_COOKIE, seal(opts.refreshToken, SECRET));
  return req;
}

const location = (res: Response) => {
  const url = new URL(res.headers.get("location")!);
  return url.pathname + url.search;
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COOKIE_SECRET = SECRET;
  vi.mocked(getAuthorizer).mockReturnValue({ isAuthorized });
  isAuthorized.mockResolvedValue("allow");
});

describe("proxy: ungated and unauthenticated", () => {
  it("passes an ungated path through without deciding anything", async () => {
    const res = await proxy(request("/about"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(isAuthorized).not.toHaveBeenCalled();
  });

  it("redirects a page request without a session to /login with ?next", async () => {
    expect(location(await proxy(request("/tools/news-desk")))).toBe("/login?next=/tools/news-desk");
  });

  it("keeps / legible in ?next but still escapes query and hash characters", async () => {
    const res = await proxy(request("/tools/a%3Fb%23c%26d"));
    const url = new URL(res.headers.get("location")!);
    expect(url.search).toBe("?next=/tools/a%253Fb%2523c%2526d");
  });

  it("answers an API request without a session with 401", async () => {
    const res = await proxy(request("/api/news-desk/ask", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("proxy: decisions", () => {
  it("lets an allowed request through, passing tool, action and the time", async () => {
    const res = await proxy(request("/tools/news-desk", { idToken: token(["friends"]) }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(isAuthorized).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "news-desk", action: "view", context: { now: expect.any(Number) } }),
    );
  });

  it.each([[null], [["us-east-1_x_Google"]]])("sends a user in neither group (%j) to /access-requested", async (groups) => {
    const res = await proxy(request("/tools", { idToken: token(groups) }));
    expect(location(res)).toBe("/access-requested");
    expect(isAuthorized).not.toHaveBeenCalled();
  });

  it("answers the same user's API call with 403 no_access", async () => {
    const res = await proxy(request("/api/news-desk/ask", { method: "POST", idToken: token(null) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no_access" });
  });

  it("denies a gated path with no ROUTE_ACTIONS row without asking", async () => {
    const res = await proxy(request("/tools/news-desk", { method: "POST", idToken: token(["owner"]) }));
    expect(location(res)).toBe("/access-denied?reason=forbidden");
    expect(isAuthorized).not.toHaveBeenCalled();
  });

  it("sends a denied page to /access-denied naming the tool and action", async () => {
    isAuthorized.mockResolvedValue("deny");
    const res = await proxy(request("/tools/resume-admin", { idToken: token(["friends"]) }));
    expect(location(res)).toBe("/access-denied?reason=forbidden&tool=resume-admin&action=view");
  });

  it("answers a denied metered API call with 403 no_grant", async () => {
    isAuthorized.mockResolvedValue("deny");
    const res = await proxy(request("/api/news-desk/ask", { method: "POST", idToken: token(["friends"]) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no_grant" });
  });

  it("answers a denied non-metered API call with 403 forbidden", async () => {
    isAuthorized.mockResolvedValue("deny");
    const res = await proxy(request("/api/resume/publish", { method: "POST", idToken: token(["friends"]) }));
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("fails closed with 503 when the authorizer throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    isAuthorized.mockRejectedValue(new Error("timeout"));
    const res = await proxy(request("/api/news-desk/ask", { method: "POST", idToken: token(["owner"]) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "authorization_unavailable" });
  });

  it("fails closed on a page too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    isAuthorized.mockRejectedValue(new Error("timeout"));
    const res = await proxy(request("/tools", { idToken: token(["owner"]) }));
    expect(location(res)).toBe("/access-denied?reason=authorization_unavailable&tool=hub&action=view");
  });
});

describe("proxy: refresh", () => {
  it("refreshes a token about to expire, decides with the new one, and hands it to the page", async () => {
    const fresh = token(["friends"], NOW_S + 900);
    vi.mocked(refreshIdToken).mockResolvedValue(fresh);
    vi.mocked(verifyIdToken).mockResolvedValue(true);

    const res = await proxy(request("/tools", { idToken: token(["friends"], NOW_S + 30), refreshToken: "rt" }));

    expect(refreshIdToken).toHaveBeenCalledWith("rt");
    expect(isAuthorized).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ idToken: fresh }) }));
    expect(unseal(res.cookies.get(ID_COOKIE)!.value, SECRET)).toBe(fresh);
    // The page runs after the proxy and reads cookies() from the request, so the
    // request's cookie header has to carry the new token too.
    expect(res.headers.get("x-middleware-override-headers")).toContain("cookie");
    expect(res.headers.get("x-middleware-request-cookie")).toContain(`${ID_COOKIE}=`);
  });

  it("leaves a token with time left alone", async () => {
    await proxy(request("/tools", { idToken: token(["friends"], NOW_S + 600), refreshToken: "rt" }));
    expect(refreshIdToken).not.toHaveBeenCalled();
  });

  it.each([
    ["the refresh call fails", () => vi.mocked(refreshIdToken).mockRejectedValue(new Error("400"))],
    ["the new token fails verification", () => {
      vi.mocked(refreshIdToken).mockResolvedValue(token(["friends"]));
      vi.mocked(verifyIdToken).mockResolvedValue(false);
    }],
  ])("signs the user out when %s", async (_label, arrange) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    arrange();
    const res = await proxy(request("/tools/news-desk", { idToken: token(["friends"], NOW_S - 10), refreshToken: "rt" }));
    expect(location(res)).toBe("/login?next=/tools/news-desk");
    expect(res.cookies.get(ID_COOKIE)?.value).toBe("");
    expect(res.cookies.get(REFRESH_COOKIE)?.value).toBe("");
  });

  it("signs out an expired session with no refresh cookie, with 401 for an API", async () => {
    const res = await proxy(request("/api/news-desk/ask", { method: "POST", idToken: token(["friends"], NOW_S - 10) }));
    expect(res.status).toBe(401);
    expect(res.cookies.get(ID_COOKIE)?.value).toBe("");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd web && npx vitest run proxy.test.ts`
Expected: FAIL (the proxy is synchronous and imports removed functions).

- [ ] **Step 3: Implement**

Replace `web/proxy.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookies,
  ID_COOKIE,
  readSession,
  seal,
  sessionFromTokens,
  setSessionCookies,
  type Session,
} from "./lib/auth";
import { refreshIdToken, verifyIdToken } from "./lib/cognito";
import { getAuthorizer, type AuthzContext } from "./lib/authz/authorizer";
import { actionFor, isGatedPath, isMetered, type RouteAction } from "./lib/route-gate";

export type Denial =
  | "no_access"
  | "forbidden"
  | "no_grant"
  | "quota_exhausted"
  | "grant_expired"
  | "authorization_unavailable";

// Refresh a little early, so a token doesn't expire between this check and
// Verified Permissions reading it.
const REFRESH_MARGIN_S = 60;
// Groups that any policy grants anything to. Every Google user is also in an
// automatic "<pool>_Google" group, which no policy mentions.
const MEMBER_GROUPS = ["owner", "friends"];

const isApi = (request: NextRequest) => request.nextUrl.pathname.startsWith("/api/");

function toLogin(request: NextRequest): NextResponse {
  if (isApi(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const loginUrl = new URL("/login", request.url);
  // Built by hand, not searchParams.set(): URLSearchParams escapes "/" too,
  // which RFC 3986 allows unescaped in a query, and ?next=%2Ftools%2F... is
  // unreadable in the address bar. Everything else stays escaped.
  loginUrl.search = "?next=" + encodeURIComponent(request.nextUrl.pathname).replaceAll("%2F", "/");
  return NextResponse.redirect(loginUrl);
}

function deny(request: NextRequest, reason: Denial, route: RouteAction | null): NextResponse {
  if (isApi(request)) {
    return NextResponse.json({ error: reason }, { status: reason === "authorization_unavailable" ? 503 : 403 });
  }
  if (reason === "no_access") return NextResponse.redirect(new URL("/access-requested", request.url));
  const url = new URL("/access-denied", request.url);
  const params = new URLSearchParams({ reason });
  if (route) {
    params.set("tool", route.tool);
    params.set("action", route.action);
  }
  url.search = params.toString();
  return NextResponse.redirect(url);
}

/** The session, with its ID token refreshed if it has a minute or less left.
 * Null means signed out: no cookie, or a refresh that failed. */
async function currentSession(
  request: NextRequest,
  secret: string,
): Promise<{ session: Session; refreshed: boolean } | null> {
  const session = readSession(request.cookies, secret);
  if (!session) return null;
  if (session.expiresAt - Math.floor(Date.now() / 1000) > REFRESH_MARGIN_S) return { session, refreshed: false };
  if (!session.refreshToken) return null;
  try {
    const idToken = await refreshIdToken(session.refreshToken);
    if (!(await verifyIdToken(idToken))) {
      console.error("auth: a refreshed ID token failed verification");
      return null;
    }
    const fresh = sessionFromTokens(idToken, session.refreshToken);
    return fresh ? { session: fresh, refreshed: true } : null;
  } catch (err) {
    // Revoked (the member was removed) or past 7 days: sign in again.
    console.error("auth: token refresh failed", err);
    return null;
  }
}

async function decide(request: NextRequest, session: Session): Promise<NextResponse> {
  if (!session.groups.some((group) => MEMBER_GROUPS.includes(group))) {
    return deny(request, "no_access", null);
  }
  const route = actionFor(request.method, request.nextUrl.pathname);
  if (!route) return deny(request, "forbidden", null);

  const context: AuthzContext = { now: Math.floor(Date.now() / 1000) };
  // Part 2 (grants) reads the user's grant for metered actions here.

  let decision;
  try {
    decision = await getAuthorizer().isAuthorized({ session, tool: route.tool, action: route.action, context });
  } catch (err) {
    console.error("authz: no decision", err);
    return deny(request, "authorization_unavailable", route);
  }
  if (decision !== "allow") return deny(request, isMetered(route.action) ? "no_grant" : "forbidden", route);
  return NextResponse.next();
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (!isGatedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    console.error("auth: COOKIE_SECRET is not set");
    return deny(request, "authorization_unavailable", null);
  }

  const current = await currentSession(request, secret);
  if (!current) {
    const response = toLogin(request);
    clearSessionCookies(response);
    return response;
  }

  if (!current.refreshed) return decide(request, current.session);

  // Pages and route handlers read cookies() from the request, after this runs,
  // so the new token goes into the request's cookie header as well as the
  // response's Set-Cookie.
  request.cookies.set(ID_COOKIE, seal(current.session.idToken, secret));
  const decided = await decide(request, current.session);
  const response =
    decided.headers.get("x-middleware-next") === "1"
      ? NextResponse.next({ request: { headers: request.headers } })
      : decided;
  setSessionCookies(response, { idToken: current.session.idToken }, secret);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 4: Run the tests and the type check**

Run: `cd web && npx vitest run proxy.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

If the two `x-middleware-*` assertions fail but the cookie assertion passes, `request.cookies.set()` didn't update the request's `cookie` header in this Next version. Build the header explicitly instead: in `proxy()`, replace `NextResponse.next({ request: { headers: request.headers } })` with

```ts
      ? (() => {
          const headers = new Headers(request.headers);
          headers.set("cookie", request.cookies.toString());
          return NextResponse.next({ request: { headers } });
        })()
```

and run the test again. If the header names still differ, print `Object.fromEntries(res.headers)` and assert on the names this Next version uses. The behaviour to pin is that the request's cookie header is overridden.

- [ ] **Step 5: Commit**

```bash
git add web/proxy.ts web/proxy.test.ts
git commit -m "feat(access): proxy asks Verified Permissions about every gated request (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 9: Denial pages and a hub that lists only allowed tools

**Files:**
- Create: `web/lib/authz/access-request.ts`, `web/lib/authz/visible-tools.ts`
- Create: `web/app/access-requested/page.tsx`, `web/app/access-denied/page.tsx`
- Test: `web/lib/authz/access-request.test.ts`, `web/lib/authz/visible-tools.test.ts`, `web/app/access-denied/page.test.tsx`, `web/app/access-requested/page.test.tsx`
- Modify: `web/app/tools/page.tsx`, `web/app/tools/page.test.tsx`

**Interfaces:**
- Consumes: `readSession` (Task 4), `TOOLS`, `Tool`, `ToolId`, `ActionId` (Task 5), `getAuthorizer` (Task 7).
- Produces: `ACCESS_EMAIL = "access@ashutosh-pandey.com"`; `requestAccessHref(subject: string): string`; `visibleTools(): Promise<Tool[]>`.

- [ ] **Step 1: Write the failing tests**

`web/lib/authz/access-request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACCESS_EMAIL, requestAccessHref } from "./access-request";

describe("requestAccessHref", () => {
  it("percent-encodes the subject and body, with %20 for spaces", () => {
    const href = requestAccessHref("Access request: News Desk newsdesk:ask");
    expect(href.startsWith(`mailto:${ACCESS_EMAIL}?subject=`)).toBe(true);
    expect(href).toContain("subject=Access%20request%3A%20News%20Desk%20newsdesk%3Aask");
    expect(href).not.toContain("+");
    expect(decodeURIComponent(href.split("&body=")[1])).toContain("Roughly how many times:");
  });
});
```

`web/lib/authz/visible-tools.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("./authorizer", () => ({ getAuthorizer: vi.fn() }));

import { cookies } from "next/headers";
import { getAuthorizer } from "./authorizer";
import { ID_COOKIE, seal } from "../auth";
import { visibleTools } from "./visible-tools";

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const isAuthorized = vi.fn();

function withCookie(value?: string) {
  vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (n === ID_COOKIE && value ? { value } : undefined) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COOKIE_SECRET = "secret";
  vi.mocked(getAuthorizer).mockReturnValue({ isAuthorized });
});

describe("visibleTools", () => {
  it("keeps the tools whose page action is allowed, in TOOLS order", async () => {
    withCookie(seal(jwt({ sub: "u", exp: 9e9, "cognito:groups": ["friends"] }), "secret"));
    isAuthorized.mockImplementation(async ({ tool }) => (["bgm-looper", "news-desk"].includes(tool) ? "allow" : "deny"));
    expect((await visibleTools()).map((t) => t.id)).toEqual(["bgm-looper", "news-desk"]);
    expect(isAuthorized).toHaveBeenCalledWith(expect.objectContaining({ tool: "keystatic", action: "keystatic:use" }));
  });

  it("hides a tool whose check throws rather than failing the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    withCookie(seal(jwt({ sub: "u", exp: 9e9, "cognito:groups": ["owner"] }), "secret"));
    isAuthorized.mockImplementation(async ({ tool }) => {
      if (tool === "keystatic") throw new Error("timeout");
      return "allow";
    });
    expect((await visibleTools()).map((t) => t.id)).not.toContain("keystatic");
  });

  it("is empty without a session", async () => {
    withCookie(undefined);
    expect(await visibleTools()).toEqual([]);
    expect(isAuthorized).not.toHaveBeenCalled();
  });
});
```

`web/app/access-denied/page.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AccessDeniedPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const page = (query: Record<string, string>) => AccessDeniedPage({ searchParams: Promise.resolve(query) });

describe("AccessDeniedPage", () => {
  it.each([
    ["forbidden", "This account can't open that."],
    ["no_grant", "That uses paid services, and needs a separate grant."],
    ["quota_exhausted", "You've used every run your grant allowed."],
    ["grant_expired", "Your grant for that has expired."],
    ["authorization_unavailable", "Access can't be checked right now."],
  ])("explains reason=%s", async (reason, message) => {
    render(await page({ reason, tool: "news-desk", action: "newsdesk:ask" }));
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("links to an email request naming the tool and action", async () => {
    render(await page({ reason: "no_grant", tool: "news-desk", action: "newsdesk:ask" }));
    expect(screen.getByRole("link", { name: /access@ashutosh-pandey\.com/ }).getAttribute("href")).toContain(
      "subject=Access%20request%3A%20News%20Desk%20newsdesk%3Aask",
    );
  });

  it("falls back to a general message for an unknown reason and ignores unknown tools", async () => {
    render(await page({ reason: "<script>", tool: "nope" }));
    expect(screen.getByText("This account can't open that.")).toBeInTheDocument();
  });
});
```

`web/app/access-requested/page.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AccessRequestedPage from "./page";
import { isGatedPath } from "../../lib/route-gate";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("AccessRequestedPage", () => {
  it("says what to do and where to write", () => {
    render(<AccessRequestedPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Access requested" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /access@ashutosh-pandey\.com/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^mailto:access@ashutosh-pandey\.com\?subject=/),
    );
  });

  // Both pages have to be reachable by someone the gate just turned away.
  it.each(["/access-requested", "/access-denied"])("%s is not gated", (path) => {
    expect(isGatedPath(path)).toBe(false);
  });
});
```

In `web/app/tools/page.test.tsx`, add at the top (after the `next/navigation` mock):

```tsx
// A factory can't use the file's own imports: vi.mock is hoisted above them.
vi.mock("../../lib/authz/visible-tools", async () => {
  const { TOOLS } = await import("../../lib/route-gate");
  return { visibleTools: vi.fn(async () => TOOLS) };
});
```

and add this test:

```tsx
  it("lists only the tools visibleTools returns", async () => {
    const { visibleTools } = await import("../../lib/authz/visible-tools");
    vi.mocked(visibleTools).mockResolvedValueOnce(TOOLS.filter((t) => t.id === "news-desk"));
    render(await hub());
    expect(screen.getByRole("link", { name: /News Desk/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Resume admin/ })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `cd web && npx vitest run lib/authz/access-request.test.ts lib/authz/visible-tools.test.ts app/access-denied app/access-requested app/tools/page.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the helpers**

`web/lib/authz/access-request.ts`:

```ts
export const ACCESS_EMAIL = "access@ashutosh-pandey.com";

const BODY = ["Who you are:", "", "What you'd like to try:", "", "Roughly how many times:", ""].join("\n");

/** encodeURIComponent, not URLSearchParams: the latter writes spaces as "+",
 * which several mail clients show literally in a mailto subject. */
export function requestAccessHref(subject: string): string {
  return `mailto:${ACCESS_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(BODY)}`;
}
```

`web/lib/authz/visible-tools.ts`:

```ts
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
```

- [ ] **Step 4: Implement the pages**

Both follow the login page's layout: outside `(site)`, root layout only.

`web/app/access-requested/page.tsx`:

```tsx
import Link from "next/link";
import { ACCESS_EMAIL, requestAccessHref } from "../../lib/authz/access-request";

// Outside the (site) group like /login: the visitor is signed in but has been
// given nothing yet, so there is no nav into the tools.
export default function AccessRequestedPage() {
  return (
    <main className="flex min-h-screen flex-col px-5 py-14 font-ui sm:px-10">
      <p className="text-xs uppercase tracking-[0.14em] text-muted">Tools</p>
      <h1 className="mt-3 font-display text-5xl leading-[0.95] sm:text-[5.25rem]">Access requested</h1>
      <div className="mt-5 border-b-2 border-rule-heavy" />
      <p className="mt-[18px] max-w-[52ch] text-base leading-relaxed text-muted">
        You&apos;re signed in, but this account hasn&apos;t been given access yet. Write to{" "}
        <a href={requestAccessHref("Access request")} className="text-accent hover:text-fg">
          {ACCESS_EMAIL}
        </a>{" "}
        with who you are and what you&apos;d like to try.
      </p>
      <p className="mt-9 text-[0.8125rem] text-muted">
        Back to the{" "}
        <Link href="/" className="text-accent hover:text-fg">
          public site
        </Link>
        .
      </p>
    </main>
  );
}
```

`web/app/access-denied/page.tsx`:

```tsx
import Link from "next/link";
import { ACCESS_EMAIL, requestAccessHref } from "../../lib/authz/access-request";
import { TOOLS } from "../../lib/route-gate";

const MESSAGES: Record<string, string> = {
  forbidden: "This account can't open that.",
  no_grant: "That uses paid services, and needs a separate grant.",
  quota_exhausted: "You've used every run your grant allowed.",
  grant_expired: "Your grant for that has expired.",
  authorization_unavailable: "Access can't be checked right now.",
};

const TOOL_NAMES: Record<string, string> = { hub: "Tools hub", ...Object.fromEntries(TOOLS.map((t) => [t.id, t.name])) };
// Only the action shapes the gate produces; anything else is dropped from the subject.
const ACTION = /^[a-z]+(:[a-z]+)?$/;

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { reason, tool, action } = await searchParams;
  const message = (typeof reason === "string" && MESSAGES[reason]) || MESSAGES.forbidden;
  const toolName = typeof tool === "string" ? TOOL_NAMES[tool] : undefined;
  const actionId = typeof action === "string" && ACTION.test(action) ? action : undefined;
  const subject = ["Access request:", toolName, actionId].filter(Boolean).join(" ");

  return (
    <main className="flex min-h-screen flex-col px-5 py-14 font-ui sm:px-10">
      <p className="text-xs uppercase tracking-[0.14em] text-muted">Tools</p>
      <h1 className="mt-3 font-display text-5xl leading-[0.95] sm:text-[5.25rem]">Not available</h1>
      <div className="mt-5 border-b-2 border-rule-heavy" />
      <p className="mt-[18px] max-w-[52ch] text-base leading-relaxed text-fg">{message}</p>
      {reason !== "authorization_unavailable" ? (
        <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-muted">
          To ask for it, write to{" "}
          <a href={requestAccessHref(subject)} className="text-accent hover:text-fg">
            {ACCESS_EMAIL}
          </a>
          .
        </p>
      ) : null}
      <p className="mt-9 text-[0.8125rem] text-muted">
        Back to{" "}
        <Link href="/tools" className="text-accent hover:text-fg">
          your tools
        </Link>
        .
      </p>
    </main>
  );
}
```

- [ ] **Step 5: The hub lists only allowed tools**

In `web/app/tools/page.tsx`:
- add `import { visibleTools } from "../../lib/authz/visible-tools";` and remove the `TOOLS` import
- at the top of `ToolsPage`, after reading `passkey`, add `const tools = await visibleTools();`
- change `{TOOLS.map((tool) => (` to `{tools.map((tool) => (`
- replace the paragraph "Everything the one shared password opens. You are through the gate for this session." with "The tools this account can open."

- [ ] **Step 6: Run the tests**

Run: `cd web && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: the whole unit suite passes, no type or lint errors.

- [ ] **Step 7: Commit**

```bash
git add web/lib/authz web/app/access-requested web/app/access-denied web/app/tools
git commit -m "feat(access): denial pages and a hub filtered by permission (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 10: e2e under the local authorizer

**Files:**
- Modify: `web/e2e/session.ts`, `web/playwright.config.ts`
- Create: `web/e2e/access.spec.ts`

**Interfaces:**
- Consumes: `seal`, `ID_COOKIE` (Task 4); the local authorizer (Task 7).
- Produces: `signIn(page: Page, baseURL: string, role?: "owner" | "friends" | "pending"): Promise<void>` (default `"owner"`, so existing specs keep working unchanged).

- [ ] **Step 1: Forge the new session**

Replace `web/e2e/session.ts`:

```ts
import type { Page } from "@playwright/test";
import { ID_COOKIE, seal } from "../lib/auth";

// Must match COOKIE_SECRET in playwright.config.ts's webServer env.
const E2E_COOKIE_SECRET = "devsecret";

export type Role = "owner" | "friends" | "pending";

/** An unsigned token: under AUTHZ_MODE=local the server trusts the claims
 * inside the encrypted cookie and evaluates the real Cedar policies. `exp` is an
 * hour out so the proxy never tries to refresh it. */
function testToken(role: Role): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = {
    sub: `e2e-${role}`,
    email: `${role}@example.com`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...(role === "pending" ? {} : { "cognito:groups": [role] }),
  };
  return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.`;
}

/** Signs the browser in the way /api/auth/callback would, without Cognito. */
export async function signIn(page: Page, baseURL: string, role: Role = "owner"): Promise<void> {
  await page.context().addCookies([
    {
      name: ID_COOKIE,
      value: seal(testToken(role), E2E_COOKIE_SECRET),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
```

- [ ] **Step 2: Run the server with the local authorizer**

In `web/playwright.config.ts`'s `webServer.env`, remove `OWNER_EMAIL` and add:

```ts
      // Decisions come from the Cedar files in infra/shared/cedar, evaluated
      // in-process; there is no Verified Permissions or Cognito under e2e.
      AUTHZ_MODE: "local",
```

- [ ] **Step 3: Write the access spec**

`web/e2e/access.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { signIn } from "./session";

test("a signed-in user in no group is sent to Access requested", async ({ page, baseURL }) => {
  await signIn(page, baseURL!, "pending");
  await page.goto("/tools");
  await expect(page).toHaveURL(/\/access-requested$/);
  await expect(page.getByRole("link", { name: "access@ashutosh-pandey.com" })).toBeVisible();
});

test("a friend's hub lists only the shareable tools", async ({ page, baseURL }) => {
  await signIn(page, baseURL!, "friends");
  await page.goto("/tools");
  for (const name of ["BGM Looper", "Money Planner", "News Desk"]) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  }
  for (const name of ["Resume admin", "Newsletter admin", "Content editor"]) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
  }
});

test("a friend opening an owner-only tool lands on Access denied", async ({ page, baseURL }) => {
  await signIn(page, baseURL!, "friends");
  await page.goto("/tools/resume-admin");
  await expect(page).toHaveURL(/\/access-denied\?reason=forbidden&tool=resume-admin&action=view$/);
  await expect(page.getByText("This account can't open that.")).toBeVisible();
});

test("a friend without a grant can't ask the News Desk assistant", async ({ page, baseURL }) => {
  await signIn(page, baseURL!, "friends");
  const res = await page.request.post("/api/news-desk/ask", { data: { question: "CPI?" } });
  expect(res.status()).toBe(403);
  expect(await res.json()).toEqual({ error: "no_grant" });
});

test("the owner's hub lists every tool", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/tools");
  for (const name of ["BGM Looper", "Resume admin", "Newsletter admin", "Money Planner", "News Desk", "Content editor"]) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  }
});
```

- [ ] **Step 4: Build and run e2e**

```bash
cd web
KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build
npm run test:e2e
```

Expected: the build succeeds and every spec passes, old and new.

If the build or the first gated e2e request fails loading `@cedar-policy/cedar-wasm` inside the proxy (a module-not-found or `.wasm` lookup error in the server log), use the fallback:

1. Move the in-process evaluation out of `local.ts` into `web/lib/authz/evaluate-locally.ts`, exporting `evaluateLocally(poolId, request): Promise<Decision>`. It is the only module that imports `@cedar-policy/cedar-wasm/nodejs` and `./cedar-files` (which uses `node:fs`).
2. Add `web/app/api/authz/evaluate/route.ts`, a `POST` handler that returns `404` unless `AUTHZ_MODE === "local"` and `VERCEL` is unset, and otherwise calls `evaluateLocally(process.env.COGNITO_USER_POOL_ID, body)` on the JSON body `{ session: { sub, groups }, tool, action, context }` and returns `{ decision }`.
3. Make `createLocalAuthorizer` import neither Cedar nor `cedar-files`: it `fetch`es `http://localhost:${process.env.PORT ?? 3100}/api/authz/evaluate` and returns the `decision`.
4. Point `local.test.ts` at `evaluateLocally`.
5. `/api/authz` must stay ungated (the proxy would otherwise call itself): add `["/api/authz/evaluate", false]` to `isGatedPath`'s test table.

- [ ] **Step 5: Commit**

```bash
git add web/e2e web/playwright.config.ts
git commit -m "test(access): e2e across owner, friend and pending users (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 11: Runbook, docs, CHANGELOG, PR

**Files:**
- Create: `docs/runbooks/link-owner-google.md`
- Modify: `docs/runbooks/README.md` (add a row), `CLAUDE.md`, `.claude/rules/web.md`, `.claude/rules/infra.md`, `ARCHITECTURE.md`, `CHANGELOG.md`

- [ ] **Step 1: Write the runbook**

`docs/runbooks/link-owner-google.md`:

````markdown
# Link the owner's Google sign-in to the owner user

The Cognito pool has one native owner user, created by Terraform and in the `owner` group. Signing in with Google creates a second, separate user (`Google_<id>`) that is in no group, so it lands on "Access requested". Linking makes Google sign in as the native user.

A passkey registered to the Google user is lost when it is deleted in step 2. Register it again afterwards from the hub.

1. Sign in once at https://ashutosh-pandey.com/login with Google. You'll see "Access requested".
2. Find and delete the Google user:

   ```bash
   POOL=us-east-1_TagY3QxyT
   aws cognito-idp list-users --user-pool-id $POOL --filter 'username ^= "Google_"' \
     --profile personal --region us-east-1 --query 'Users[].Username'
   # -> ["Google_1234567890"]
   aws cognito-idp admin-delete-user --user-pool-id $POOL --username Google_1234567890 \
     --profile personal --region us-east-1
   ```

3. Link the Google identity to the native owner user (`<email>` is `alert_email` in `infra/shared/terraform.tfvars`; `<id>` is the number after `Google_`):

   ```bash
   aws cognito-idp admin-link-provider-for-user --user-pool-id $POOL \
     --destination-user ProviderName=Cognito,ProviderAttributeValue=<email> \
     --source-user ProviderName=Google,ProviderAttributeName=Cognito_Subject,ProviderAttributeValue=<id> \
     --profile personal --region us-east-1
   ```

4. Sign in with Google again. You reach the hub with every tool listed.
````

Add to the table in `docs/runbooks/README.md`: `| [link-owner-google.md](link-owner-google.md) | Once, after access control ships: make Google sign in as the owner user |` (match the table's existing columns).

- [ ] **Step 2: Update the docs**

- `CLAUDE.md` Structure bullet for `web/`: after "…`web/lib/route-gate.ts` is the single source of truth for what's gated *and* for the list of tools itself", add: "and, through `ROUTE_ACTIONS`, for which Cedar action each gated route needs. Amazon Verified Permissions decides every gated request (`web/lib/authz/`, policies in `infra/shared/cedar/`)."
- `.claude/rules/web.md`: replace the sign-in bullet's last three sentences (from "The session cookie itself is unchanged" to the end) with: "The session is two AES-256-GCM cookies, `site_id` (the ID token) and `site_refresh` (the refresh token), keyed from `COOKIE_SECRET` in `web/lib/auth.ts`. Any Cognito user gets a session; `proxy.ts` refreshes the ID token when it has a minute left and asks the `Authorizer` (`web/lib/authz/`) for a decision on the `(tool, action)` that `actionFor()` maps the request to. An unmapped gated route is denied, and `lib/route-coverage.test.ts` fails for any gated `route.ts` or `page.tsx` without a row. Under Playwright, `AUTHZ_MODE=local` evaluates the same Cedar files in-process, and `web/e2e/session.ts` forges a cookie per role (`owner` by default, `friends`, `pending`). `AUTHZ_MODE=local` with `VERCEL` set denies everything." Replace "requires `OWNER_EMAIL` with `email_verified`" with "verifies it". In the `playwright.config.ts` bullet, replace "dummy `COGNITO_*`/`OWNER_EMAIL`" with "dummy `COGNITO_*`, `AUTHZ_MODE=local`".
- `.claude/rules/infra.md`: add a bullet: "**`infra/shared/cedar/` is deployed by Terraform, not Vercel.** `access.tf` loads the schema and one `aws_verifiedpermissions_policy` per `.cedar` file, filling `${pool}` with the user pool ID. The policy store is `STRICT`, so a policy that doesn't match the schema fails at apply; `web/lib/authz/policies.test.ts` runs the same files through `cedar-wasm` first. A change under `cedar/` doesn't trigger a Vercel build (the `ignore_command` allowlist is `web/` and `content/`) and doesn't need one."
- `ARCHITECTURE.md`: in its auth/sign-in section, add one paragraph: "Authorization: Amazon Verified Permissions, one policy store shared by all branches, with the Cognito pool as identity source. The proxy calls `IsAuthorizedWithToken` for every gated request ($0.000005 each). Groups `owner` and `friends`; see `docs/superpowers/specs/2026-09-29-access-control-design.md`."

- [ ] **Step 3: CHANGELOG**

Under `## [Unreleased]` → `### Added` in `CHANGELOG.md`, add:

```markdown
- Access control for `/tools`: Amazon Verified Permissions decides every request from Cedar policies, with Cognito groups `owner` and `friends`. Anyone can sign in with Google; an account in neither group sees "Access requested" and an address to write to. Friends see BGM Looper, Money Planner and News Desk; actions that cost money need a separate grant, which arrives with part 2 (#300).
```

and under `### Changed` (create the heading if absent):

```markdown
- The session is now the user's Cognito tokens in two encrypted cookies, refreshed every 15 minutes, replacing the signed timestamp. Everyone signs in again once (#300).
```

- [ ] **Step 4: Full verification**

```bash
cd /e/Personal/looper/web && npm test && npm run lint && npx tsc --noEmit
```

Expected: all green. This PR doesn't touch `infra/`, so it gets no Terraform plan.

- [ ] **Step 5: Commit, push, open the PR**

```bash
cd /e/Personal/looper
git add docs/runbooks CLAUDE.md .claude/rules ARCHITECTURE.md CHANGELOG.md
git commit -m "docs: access control core (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push
gh pr create --base dev --title "feat: Verified Permissions access control core (#300)" --body "$(cat <<'EOF'
Part 1b of #300 (spec: docs/superpowers/specs/2026-09-29-access-control-design.md, plan: docs/superpowers/plans/2026-09-29-access-control-authorization.md).

- Uses the policy store, groups and token lifetimes applied by the infra PR (Tasks 1-2)
- Session is the Cognito tokens in two encrypted cookies; the callback no longer checks OWNER_EMAIL
- proxy.ts maps every gated route to a Cedar action and asks Verified Permissions; unmapped routes are denied
- /access-requested and /access-denied; the hub lists only allowed tools
- e2e runs the same Cedar files in-process under AUTHZ_MODE=local

Credentials probe in the proxy on this branch's preview: <paste Task 3's JSON>

After merge: every session ends once. Run docs/runbooks/link-owner-google.md if you sign in with Google.

Refs #300
EOF
)"
```

Then invoke the `merging-a-pr` skill and follow it to merge.

---

### Task 12: Verify on `dev`, then remove `OWNER_EMAIL` after promotion

- [ ] **Step 1: Manual check on https://dev.ashutosh-pandey.com after the merge deploys**

1. Sign in as the owner with an email code → the hub lists all six tools.
2. Leave the tab for 16 minutes, then reload `/tools` → it still lists all six (the proxy refreshed the token and handed it to the page). If it lists none, Review Focus 5 is broken.
3. Sign in with a second Google account (a private window) → `/access-requested`.
4. In the first window, open `/tools/news-desk` and ask one question → it answers (owner, no grant needed).
5. Run `docs/runbooks/link-owner-google.md` if you use Google sign-in.

- [ ] **Step 2: After this reaches `main`, remove `OWNER_EMAIL`**

Only once `stage` and `main` run the new callback; until then they still read it. On a new branch from `dev`: delete `resource "vercel_project_environment_variable" "owner_email"` from `infra/shared/auth.tf` and open a PR with `Refs #300`. CI's plan for `shared` shows `1 to destroy`, which is the intent. After the merge the apply on `dev` stops at the destroy; run it by hand with `gh workflow run terraform.yml --ref dev -f stack=shared -f confirm=apply-destroys`.
