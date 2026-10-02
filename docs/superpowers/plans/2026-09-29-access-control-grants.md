# Access control, part 2: grants and the Access page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Metered actions work for friends who hold a grant with a quota and an expiry, and the owner approves people and makes or revokes grants from `/tools/access-admin`.

**Architecture:** A DynamoDB table holds one row per `(sub, action)` grant. For a metered action the proxy reads the row, passes `remaining` and `expiresAt` to Verified Permissions as `context.grant`, and on allow consumes one use with a conditional update. The Access page lists Cognito users (pending = in neither `owner` nor `friends`) and calls owner-only `/api/access/*` routes that change Cognito groups and grant rows.

**Tech Stack:** `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-cognito-identity-provider`, zod, Next.js route handlers, Vitest with `aws-sdk-client-mock`.

**Spec:** `docs/superpowers/specs/2026-09-29-access-control-design.md` (§5 "What the proxy does" steps 4–6, §6, §8 table and IAM, §11 PR 2). Depends on part 1, `docs/superpowers/plans/2026-09-29-access-control-authorization.md`, being merged into `dev`.

## Global Constraints

- Everything in part 1's Global Constraints still holds.
- Two PRs into `dev`, in order, each saying `Refs #300`, each squash-merged after the `merging-a-pr` skill: `feat/access-control-grants-infra` (Task 1) from `dev` after part 1 merged, then `feat/access-control-grants` (Tasks 2–9) from `dev` after the first one merged and CI's apply on `dev` finished. The split is part 1's: a deployment keeps the env vars it was created with, so the code that reads `ACCESS_GRANTS_TABLE` ships after the apply that creates it. Part 1's Task 0 already gave `tf_apply_prod` `dynamodb:*`.
- Table `site-access-grants`: partition key `sub` (S), sort key `action` (S), `PAY_PER_REQUEST`, TTL attribute `ttl`. Attributes `email` (S), `limit` (N), `used` (N), `expiresAt` (N, epoch s), `grantedAt` (N, epoch s), `note` (S, optional), `ttl` (N = `expiresAt` + 30 days). `limit` and `ttl` are DynamoDB reserved words: every expression uses `ExpressionAttributeNames`.
- Grant form limits: `limit` 1–1000 (default 20), `expiresInDays` 1–90 (default 7), `note` at most 200 characters. Only the three metered actions can be granted.
- Granting an action that already has a row overwrites it; `used` starts at 0.
- The owner has no grant rows and is never counted.
- A request that fails after consumption still used one call.
- No change may touch a user in `owner`: the API answers 409.
- Every Access change logs one line: `console.info(JSON.stringify({ event: "access", by, op, target, action?, limit?, expiresAt? }))`.
- Response bodies for the Access API: success `{ ok: true }` (part 3 adds `emailError?: string`); failure `{ error: string }` with 400/404/409/500.

## Review Focus

1. **The last use, raced.** Two requests read `remaining = 1`; both get allow from Verified Permissions; the conditional update lets exactly one through and the other gets 403 `quota_exhausted`. Test in Task 3.
2. **A DynamoDB failure that isn't the condition.** A throttle or network error while reading or consuming must be 503 `authorization_unavailable`, not a 403 and not an unchecked pass. Tests in Tasks 2 and 3.
3. **Which denial a friend sees.** No row → `no_grant`; `used = limit` → `quota_exhausted`; past `expiresAt` → `grant_expired`, checked in that order. Test in Task 3.
4. **Revoking the owner.** Remove, dismiss or grant against the owner's `sub` returns 409 and changes nothing in Cognito. Test in Task 5.
5. **An action name with a colon in the URL.** `DELETE /api/access/grants/<sub>/newsdesk%3Aask` reaches the handler as `newsdesk:ask`. Test in Task 6.

---

### Task 1: Terraform — grants table, Cognito admin and DynamoDB permissions

**Files:**
- Modify: `infra/shared/access.tf`

**Interfaces:**
- Produces: table `site-access-grants`; Vercel env var `ACCESS_GRANTS_TABLE`; both Vercel roles may read and write the table and call the six Cognito admin actions on the pool.

- [ ] **Step 1: Branch**

```bash
cd /e/Personal/looper && git switch dev && git pull && git switch -c feat/access-control-grants-infra
```

- [ ] **Step 2: Add the table, env var and permissions**

Append to `infra/shared/access.tf`:

```hcl
# One row per (user, metered action). Shared by all branches, like the pool:
# a grant belongs to a person. TTL removes a row 30 days after it expires.
resource "aws_dynamodb_table" "access_grants" {
  name         = "site-access-grants"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sub"
  range_key    = "action"

  attribute {
    name = "sub"
    type = "S"
  }

  attribute {
    name = "action"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

resource "vercel_project_environment_variable" "access_grants_table" {
  project_id = vercel_project.looper.id
  key        = "ACCESS_GRANTS_TABLE"
  value      = aws_dynamodb_table.access_grants.name
  target     = local.env_targets
  sensitive  = false
}
```

In the same file, add two statements to `local.vercel_access_statements`, after `AuthorizeRequests`. Both Vercel roles' policies are built from that list, so dev, stage and production all get them:

```hcl
      {
        Sid      = "AccessGrants"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"]
        Resource = [aws_dynamodb_table.access_grants.arn]
      },
      {
        Sid    = "ManageAccess"
        Effect = "Allow"
        Action = [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminUserGlobalSignOut",
          "cognito-idp:AdminDeleteUser",
        ]
        Resource = [aws_cognito_user_pool.owner.arn]
      },
```

- [ ] **Step 3: Format, commit, PR**

```bash
cd /e/Personal/looper/infra/shared && terraform fmt && terraform validate
cd /e/Personal/looper
git add infra/shared/access.tf
git commit -m "feat(infra): access grants table and Access page permissions (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/access-control-grants-infra
gh pr create --base dev --title "feat(infra): access grants table and Access page permissions (#300)" --body "$(cat <<'EOF'
Part 2a of #300 (plan: docs/superpowers/plans/2026-09-29-access-control-grants.md, Task 1).

- site-access-grants DynamoDB table, on-demand, TTL on ttl
- ACCESS_GRANTS_TABLE for production and preview
- Both Vercel roles may read and write the table and call the six Cognito admin actions on the pool

Nothing reads the table yet.

Refs #300
EOF
)"
```

The `Terraform` workflow's plan for `shared` must show `2 to add, 2 to change, 0 to destroy`: the table and the env var added, both Vercel access policies updated in place. The env stacks show `No changes`.

- [ ] **Step 4: Merge, wait for the apply, check**

Invoke the `merging-a-pr` skill and merge, then:

```bash
gh run list --workflow terraform.yml --branch dev --limit 1
gh run watch <id> --exit-status
aws dynamodb describe-time-to-live --table-name site-access-grants --profile personal --region us-east-1 --query 'TimeToLiveDescription.TimeToLiveStatus'
```

Expected: the run succeeds; `"ENABLED"` (or `"ENABLING"` for a few minutes).

---

### Task 2: Grant store

**Files:**
- Create: `web/lib/authz/grants.ts`
- Test: `web/lib/authz/grants.test.ts`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: `MeteredAction`, `METERED_ACTIONS` (part 1, `lib/route-gate.ts`); `awsCredentials()` (`lib/aws.ts`).
- Produces:
  - `type Grant = { sub: string; action: MeteredAction; email: string; limit: number; used: number; expiresAt: number; grantedAt: number; note?: string }`
  - `interface GrantStore { get(sub, action): Promise<Grant | null>; consume(sub, action, now: number): Promise<boolean>; put(grant: Grant): Promise<void>; remove(sub, action): Promise<void>; list(sub): Promise<Grant[]>; removeAll(sub): Promise<void> }`
  - `getGrantStore(env?: NodeJS.ProcessEnv): GrantStore` — DynamoDB normally; an in-memory store under `AUTHZ_MODE=local` off Vercel, so e2e runs without AWS.
  - `GRANT_TTL_S = 30 * 86400`

- [ ] **Step 1: Branch and install**

```bash
cd /e/Personal/looper && git switch dev && git pull && git switch -c feat/access-control-grants
cd web && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

- [ ] **Step 2: Write the failing tests**

`web/lib/authz/grants.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getGrantStore, GRANT_TTL_S, type Grant } from "./grants";

const ddb = mockClient(DynamoDBDocumentClient);
const env = { ACCESS_GRANTS_TABLE: "grants", APP_AWS_REGION: "us-east-1" } as NodeJS.ProcessEnv;
const grant: Grant = { sub: "u1", action: "newsdesk:ask", email: "a@example.com", limit: 20, used: 3, expiresAt: 2000, grantedAt: 1000 };

beforeEach(() => ddb.reset());

describe("DynamoDB grant store", () => {
  it("gets a row by sub and action", async () => {
    ddb.on(GetCommand).resolves({ Item: grant });
    expect(await getGrantStore(env).get("u1", "newsdesk:ask")).toEqual(grant);
    expect(ddb.commandCalls(GetCommand)[0].args[0].input).toEqual({ TableName: "grants", Key: { sub: "u1", action: "newsdesk:ask" } });
  });

  it("returns null for a missing row", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await getGrantStore(env).get("u1", "newsdesk:ask")).toBeNull();
  });

  it("consumes one use only while used < limit and not expired", async () => {
    ddb.on(UpdateCommand).resolves({});
    expect(await getGrantStore(env).consume("u1", "newsdesk:ask", 1500)).toBe(true);
    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input).toEqual({
      TableName: "grants",
      Key: { sub: "u1", action: "newsdesk:ask" },
      UpdateExpression: "SET #used = #used + :one",
      ConditionExpression: "attribute_exists(#sub) AND #used < #limit AND #expiresAt > :now",
      ExpressionAttributeNames: { "#sub": "sub", "#used": "used", "#limit": "limit", "#expiresAt": "expiresAt" },
      ExpressionAttributeValues: { ":one": 1, ":now": 1500 },
    });
  });

  it("returns false when the condition fails: the last use went to another request", async () => {
    ddb.on(UpdateCommand).rejects(new ConditionalCheckFailedException({ message: "failed", $metadata: {} }));
    expect(await getGrantStore(env).consume("u1", "newsdesk:ask", 1500)).toBe(false);
  });

  it("rethrows any other DynamoDB error, so the proxy fails closed", async () => {
    ddb.on(UpdateCommand).rejects(new Error("ProvisionedThroughputExceededException"));
    await expect(getGrantStore(env).consume("u1", "newsdesk:ask", 1500)).rejects.toThrow("Provisioned");
  });

  it("puts a row with used and ttl set from the grant", async () => {
    ddb.on(PutCommand).resolves({});
    await getGrantStore(env).put({ ...grant, used: 0, note: "emailed" });
    expect(ddb.commandCalls(PutCommand)[0].args[0].input).toEqual({
      TableName: "grants",
      Item: { ...grant, used: 0, note: "emailed", ttl: 2000 + GRANT_TTL_S },
    });
  });

  it("lists a user's rows and removes them all", async () => {
    ddb.on(QueryCommand).resolves({ Items: [grant, { ...grant, action: "looper:process" }] });
    ddb.on(DeleteCommand).resolves({});
    const store = getGrantStore(env);
    expect((await store.list("u1")).map((g) => g.action)).toEqual(["newsdesk:ask", "looper:process"]);
    await store.removeAll("u1");
    expect(ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key)).toEqual([
      { sub: "u1", action: "newsdesk:ask" },
      { sub: "u1", action: "looper:process" },
    ]);
  });

  it("throws when the table name is missing", async () => {
    await expect(getGrantStore({} as NodeJS.ProcessEnv).get("u1", "newsdesk:ask")).rejects.toThrow("ACCESS_GRANTS_TABLE");
  });
});

describe("in-memory grant store (AUTHZ_MODE=local)", () => {
  const local = { AUTHZ_MODE: "local" } as NodeJS.ProcessEnv;

  it("behaves like the table", async () => {
    const store = getGrantStore(local);
    await store.put({ ...grant, sub: "mem", limit: 1, used: 0 });
    expect(await store.consume("mem", "newsdesk:ask", 1500)).toBe(true);
    expect(await store.consume("mem", "newsdesk:ask", 1500)).toBe(false);
    expect(await store.consume("mem", "newsdesk:ask", 2500)).toBe(false);
    await store.removeAll("mem");
    expect(await store.list("mem")).toEqual([]);
  });

  it("is never used on Vercel", async () => {
    await expect(getGrantStore({ AUTHZ_MODE: "local", VERCEL: "1" } as NodeJS.ProcessEnv).get("u1", "newsdesk:ask")).rejects.toThrow(
      "ACCESS_GRANTS_TABLE",
    );
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd web && npx vitest run lib/authz/grants.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`web/lib/authz/grants.ts`:

```ts
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { awsCredentials } from "../aws";
import type { MeteredAction } from "../route-gate";

export type Grant = {
  sub: string;
  action: MeteredAction;
  email: string;
  limit: number;
  used: number;
  /** Epoch seconds. */
  expiresAt: number;
  grantedAt: number;
  note?: string;
};

export interface GrantStore {
  get(sub: string, action: MeteredAction): Promise<Grant | null>;
  /** Takes one use. False when there is none left, it expired, or the row is
   * gone; throws for any other failure. */
  consume(sub: string, action: MeteredAction, now: number): Promise<boolean>;
  put(grant: Grant): Promise<void>;
  remove(sub: string, action: MeteredAction): Promise<void>;
  list(sub: string): Promise<Grant[]>;
  removeAll(sub: string): Promise<void>;
}

// DynamoDB's TTL deletes a row this long after the grant expires, which keeps
// a month of history for the Access page.
export const GRANT_TTL_S = 30 * 24 * 60 * 60;

let doc: DynamoDBDocumentClient | null = null;

function client(): DynamoDBDocumentClient {
  return (doc ??= DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.APP_AWS_REGION!, ...awsCredentials() }),
    { marshallOptions: { removeUndefinedValues: true } },
  ));
}

function dynamoStore(table: string): GrantStore {
  const key = (sub: string, action: MeteredAction) => ({ sub, action });
  const store: GrantStore = {
    async get(sub, action) {
      const out = await client().send(new GetCommand({ TableName: table, Key: key(sub, action) }));
      return (out.Item as Grant | undefined) ?? null;
    },
    async consume(sub, action, now) {
      try {
        await client().send(
          new UpdateCommand({
            TableName: table,
            Key: key(sub, action),
            UpdateExpression: "SET #used = #used + :one",
            ConditionExpression: "attribute_exists(#sub) AND #used < #limit AND #expiresAt > :now",
            // limit is a DynamoDB reserved word, so every name goes through a placeholder.
            ExpressionAttributeNames: { "#sub": "sub", "#used": "used", "#limit": "limit", "#expiresAt": "expiresAt" },
            ExpressionAttributeValues: { ":one": 1, ":now": now },
          }),
        );
        return true;
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) return false;
        throw err;
      }
    },
    async put(grant) {
      await client().send(new PutCommand({ TableName: table, Item: { ...grant, ttl: grant.expiresAt + GRANT_TTL_S } }));
    },
    async remove(sub, action) {
      await client().send(new DeleteCommand({ TableName: table, Key: key(sub, action) }));
    },
    async list(sub) {
      const out = await client().send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "#sub = :sub",
          ExpressionAttributeNames: { "#sub": "sub" },
          ExpressionAttributeValues: { ":sub": sub },
        }),
      );
      return (out.Items as Grant[] | undefined) ?? [];
    },
    async removeAll(sub) {
      for (const grant of await store.list(sub)) await store.remove(sub, grant.action);
    },
  };
  return store;
}

function notConfigured(): never {
  throw new Error("grants: ACCESS_GRANTS_TABLE is not set");
}

const unconfigured: GrantStore = {
  get: async () => notConfigured(),
  consume: async () => notConfigured(),
  put: async () => notConfigured(),
  remove: async () => notConfigured(),
  list: async () => notConfigured(),
  removeAll: async () => notConfigured(),
};

// e2e has no AWS. Same guard as the local authorizer: never on a deployment.
const memory = new Map<string, Grant>();
const memoryStore: GrantStore = {
  async get(sub, action) {
    return memory.get(`${sub}|${action}`) ?? null;
  },
  async consume(sub, action, now) {
    const grant = memory.get(`${sub}|${action}`);
    if (!grant || grant.used >= grant.limit || grant.expiresAt <= now) return false;
    grant.used += 1;
    return true;
  },
  async put(grant) {
    memory.set(`${grant.sub}|${grant.action}`, { ...grant });
  },
  async remove(sub, action) {
    memory.delete(`${sub}|${action}`);
  },
  async list(sub) {
    return [...memory.values()].filter((g) => g.sub === sub);
  },
  async removeAll(sub) {
    for (const key of [...memory.keys()]) if (key.startsWith(`${sub}|`)) memory.delete(key);
  },
};

export function getGrantStore(env: NodeJS.ProcessEnv = process.env): GrantStore {
  if (env.AUTHZ_MODE === "local" && !env.VERCEL) return memoryStore;
  const table = env.ACCESS_GRANTS_TABLE;
  return table ? dynamoStore(table) : unconfigured;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd web && npx vitest run lib/authz/grants.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/lib/authz/grants.ts web/lib/authz/grants.test.ts web/package.json web/package-lock.json
git commit -m "feat(access): grant store with conditional consumption (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 3: The proxy reads and consumes grants

**Files:**
- Modify: `web/proxy.ts` (the `decide()` function)
- Test: `web/proxy.test.ts` (add a `describe`)

**Interfaces:**
- Consumes: `getGrantStore`, `Grant` (Task 2); everything part 1's proxy uses.
- Produces: metered denials `no_grant`, `quota_exhausted`, `grant_expired`.

- [ ] **Step 1: Write the failing tests**

In `web/proxy.test.ts` add a mock next to the others:

```ts
vi.mock("./lib/authz/grants", () => ({ getGrantStore: vi.fn() }));
import { getGrantStore } from "./lib/authz/grants";
```

and in `beforeEach`:

```ts
  vi.mocked(getGrantStore).mockReturnValue(grants as never);
  grants.get.mockResolvedValue(null);
  grants.consume.mockResolvedValue(true);
```

with, at module level:

```ts
const grants = { get: vi.fn(), consume: vi.fn() };
const liveGrant = { sub: "u1", action: "newsdesk:ask", email: "a@x", limit: 5, used: 2, expiresAt: NOW_S + 3600, grantedAt: 0 };
```

Then add:

```ts
describe("proxy: metered grants", () => {
  const ask = (groups = ["friends"]) => request("/api/news-desk/ask", { method: "POST", idToken: token(groups) });

  it("passes the grant to the authorizer and consumes one use", async () => {
    grants.get.mockResolvedValue(liveGrant);
    const res = await proxy(ask());
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(isAuthorized).toHaveBeenCalledWith(
      expect.objectContaining({ context: { now: expect.any(Number), grant: { remaining: 3, expiresAt: liveGrant.expiresAt } } }),
    );
    expect(grants.consume).toHaveBeenCalledWith("u1", "newsdesk:ask", expect.any(Number));
  });

  it("checks but doesn't consume on a route that doesn't consume (the looper's upload URL)", async () => {
    grants.get.mockResolvedValue({ ...liveGrant, action: "looper:process" });
    await proxy(request("/api/looper/upload-url", { method: "POST", idToken: token(["friends"]) }));
    expect(grants.get).toHaveBeenCalledWith("u1", "looper:process");
    expect(grants.consume).not.toHaveBeenCalled();
  });

  it("neither reads nor consumes for the owner", async () => {
    await proxy(ask(["owner"]));
    expect(grants.get).not.toHaveBeenCalled();
    expect(grants.consume).not.toHaveBeenCalled();
    expect(isAuthorized).toHaveBeenCalledWith(expect.objectContaining({ context: { now: expect.any(Number) } }));
  });

  it.each([
    ["no_grant", null],
    ["quota_exhausted", { ...liveGrant, used: 5 }],
    ["grant_expired", { ...liveGrant, used: 5, expiresAt: NOW_S - 1 }],
  ])("explains a denial as %s", async (reason, grant) => {
    grants.get.mockResolvedValue(grant);
    isAuthorized.mockResolvedValue("deny");
    const res = await proxy(ask());
    expect(await res.json()).toEqual({ error: reason });
    expect(grants.consume).not.toHaveBeenCalled();
  });

  it("denies with quota_exhausted when another request took the last use", async () => {
    grants.get.mockResolvedValue({ ...liveGrant, used: 4 });
    grants.consume.mockResolvedValue(false);
    const res = await proxy(ask());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "quota_exhausted" });
  });

  it.each([
    ["reading", () => grants.get.mockRejectedValue(new Error("throttled"))],
    ["consuming", () => {
      grants.get.mockResolvedValue(liveGrant);
      grants.consume.mockRejectedValue(new Error("throttled"));
    }],
  ])("fails closed with 503 when %s the grant fails", async (_label, arrange) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    arrange();
    const res = await proxy(ask());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "authorization_unavailable" });
  });
});
```

Also update part 1's test `"answers a denied metered API call with 403 no_grant"`: it still passes, because `grants.get` resolves `null` by default.

- [ ] **Step 2: Run to see them fail**

Run: `cd web && npx vitest run proxy.test.ts`
Expected: the new block FAILS (grants never read).

- [ ] **Step 3: Implement**

In `web/proxy.ts`, add the imports:

```ts
import { getGrantStore, type Grant } from "./lib/authz/grants";
import { actionFor, isGatedPath, isMetered, type MeteredAction, type RouteAction } from "./lib/route-gate";
```

(replacing the existing `route-gate` import), add this helper above `decide()`:

```ts
/** Why a metered action was denied, from the grant the decision was made with.
 * Verified Permissions only says deny; the reason is for the person reading it. */
function meteredDenial(grant: Grant | null, now: number): Denial {
  if (!grant) return "no_grant";
  if (grant.expiresAt <= now) return "grant_expired";
  if (grant.used >= grant.limit) return "quota_exhausted";
  return "forbidden";
}
```

and replace `decide()` with:

```ts
async function decide(request: NextRequest, session: Session): Promise<NextResponse> {
  if (!session.groups.some((group) => MEMBER_GROUPS.includes(group))) {
    return deny(request, "no_access", null);
  }
  const route = actionFor(request.method, request.nextUrl.pathname);
  if (!route) return deny(request, "forbidden", null);

  const context: AuthzContext = { now: Math.floor(Date.now() / 1000) };
  // The owner's policy allows every action without a grant, and the owner is
  // never counted.
  const counted = isMetered(route.action) && !session.groups.includes("owner");
  let grant: Grant | null = null;
  if (counted) {
    try {
      grant = await getGrantStore().get(session.sub, route.action as MeteredAction);
    } catch (err) {
      console.error("authz: grant read failed", err);
      return deny(request, "authorization_unavailable", route);
    }
    if (grant) context.grant = { remaining: grant.limit - grant.used, expiresAt: grant.expiresAt };
  }

  let decision;
  try {
    decision = await getAuthorizer().isAuthorized({ session, tool: route.tool, action: route.action, context });
  } catch (err) {
    console.error("authz: no decision", err);
    return deny(request, "authorization_unavailable", route);
  }
  if (decision !== "allow") {
    return deny(request, isMetered(route.action) ? meteredDenial(grant, context.now) : "forbidden", route);
  }

  if (counted && route.consumes) {
    let consumed: boolean;
    try {
      consumed = await getGrantStore().consume(session.sub, route.action as MeteredAction, context.now);
    } catch (err) {
      console.error("authz: grant consume failed", err);
      return deny(request, "authorization_unavailable", route);
    }
    // Two requests can both be allowed on the last use; the conditional update
    // lets exactly one through.
    if (!consumed) return deny(request, "quota_exhausted", route);
  }
  return NextResponse.next();
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run proxy.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/proxy.ts web/proxy.test.ts
git commit -m "feat(access): metered actions read and consume grants (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 4: The hub shows grant usage

**Files:**
- Create: `web/lib/authz/my-grants.ts`
- Test: `web/lib/authz/my-grants.test.ts`
- Modify: `web/app/tools/page.tsx`, `web/app/tools/page.test.tsx`

**Interfaces:**
- Consumes: `readSession` (part 1), `getGrantStore` (Task 2).
- Produces: `myGrants(): Promise<Grant[]>` (the signed-in user's live grants, or `[]` for the owner, no session, or a failed read); `describeGrant(grant: Grant, now: number): string`.

- [ ] **Step 1: Write the failing tests**

`web/lib/authz/my-grants.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("./grants", () => ({ getGrantStore: vi.fn() }));

import { cookies } from "next/headers";
import { getGrantStore, type Grant } from "./grants";
import { ID_COOKIE, seal } from "../auth";
import { describeGrant, myGrants } from "./my-grants";

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const list = vi.fn();
const g = (over: Partial<Grant>): Grant => ({ sub: "u", action: "newsdesk:ask", email: "", limit: 20, used: 13, expiresAt: 1_791_504_000, grantedAt: 0, ...over });

function signedInAs(groups: string[]) {
  const value = seal(jwt({ sub: "u", exp: 9e9, "cognito:groups": groups }), "secret");
  vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (n === ID_COOKIE ? { value } : undefined) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COOKIE_SECRET = "secret";
  vi.mocked(getGrantStore).mockReturnValue({ list } as never);
});

describe("myGrants", () => {
  it("returns a friend's grants that are still usable", async () => {
    signedInAs(["friends"]);
    list.mockResolvedValue([g({}), g({ action: "looper:process", used: 20 }), g({ action: "newsdesk:refresh", expiresAt: 1 })]);
    expect((await myGrants()).map((x) => x.action)).toEqual(["newsdesk:ask"]);
  });

  it("is empty for the owner, who is never counted", async () => {
    signedInAs(["owner"]);
    expect(await myGrants()).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it("is empty rather than failing the hub when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedInAs(["friends"]);
    list.mockRejectedValue(new Error("throttled"));
    expect(await myGrants()).toEqual([]);
  });
});

describe("describeGrant", () => {
  it("names the action, what is left and the last day", () => {
    expect(describeGrant(g({}), 0)).toBe("News Desk ask: 7 of 20 left, until 9 Oct 2026");
  });
});
```

In `web/app/tools/page.test.tsx`, add `vi.mock("../../lib/authz/my-grants", () => ({ myGrants: vi.fn(async () => []), describeGrant: vi.fn(() => "News Desk ask: 7 of 20 left, until 9 Oct 2026") }));` and:

```tsx
  it("lists the viewer's grants when there are any", async () => {
    const { myGrants } = await import("../../lib/authz/my-grants");
    vi.mocked(myGrants).mockResolvedValueOnce([{ action: "newsdesk:ask" } as never]);
    render(await hub());
    expect(screen.getByText("News Desk ask: 7 of 20 left, until 9 Oct 2026")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `cd web && npx vitest run lib/authz/my-grants.test.ts app/tools/page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`web/lib/authz/my-grants.ts`:

```ts
import { cookies } from "next/headers";
import { readSession } from "../auth";
import type { MeteredAction } from "../route-gate";
import { getGrantStore, type Grant } from "./grants";

export const METERED_LABELS: Record<MeteredAction, string> = {
  "looper:process": "BGM Looper processing",
  "newsdesk:refresh": "News Desk refresh",
  "newsdesk:ask": "News Desk ask",
};

export async function myGrants(): Promise<Grant[]> {
  const secret = process.env.COOKIE_SECRET;
  const session = secret ? readSession(await cookies(), secret) : null;
  if (!session || session.groups.includes("owner")) return [];
  const now = Math.floor(Date.now() / 1000);
  try {
    const grants = await getGrantStore().list(session.sub);
    return grants.filter((g) => g.used < g.limit && g.expiresAt > now);
  } catch (err) {
    console.error("authz: could not read grants for the hub", err);
    return [];
  }
}

export function describeGrant(grant: Grant, _now: number): string {
  const until = new Date(grant.expiresAt * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  return `${METERED_LABELS[grant.action]}: ${grant.limit - grant.used} of ${grant.limit} left, until ${until}`;
}
```

(`1_791_504_000` is 9 Oct 2026 in IST, checked with Node 22's `en-GB` formatting during planning.)

In `web/app/tools/page.tsx`: import `{ describeGrant, myGrants }` from `"../../lib/authz/my-grants"`; next to `const tools = await visibleTools();` add `const grants = await myGrants(); const now = Math.floor(Date.now() / 1000);`; and after the tools `<ul>`, add:

```tsx
        {grants.length > 0 ? (
          <section className="mt-9">
            <h2 className="text-xs uppercase tracking-[0.14em] text-muted">Your grants</h2>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {grants.map((grant) => (
                <li key={grant.action}>{describeGrant(grant, now)}</li>
              ))}
            </ul>
          </section>
        ) : null}
```

- [ ] **Step 4: Run and commit**

Run: `cd web && npx vitest run lib/authz app/tools && npx tsc --noEmit`
Expected: PASS.

```bash
git add web/lib/authz/my-grants.ts web/lib/authz/my-grants.test.ts web/app/tools
git commit -m "feat(access): the hub shows the viewer's grants (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 5: Access directory — Cognito users, groups and grants

**Files:**
- Create: `web/lib/access-admin.ts`
- Test: `web/lib/access-admin.test.ts`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: `getGrantStore`, `Grant` (Task 2); `MeteredAction` (part 1).
- Produces:
  - `type AccessUser = { sub: string; username: string; email: string; createdAt: string; groups: string[] }`
  - `type AccessStatus = "owner" | "member" | "pending"`, `statusOf(user: AccessUser): AccessStatus`
  - `class AccessError extends Error { status: 404 | 409 }`
  - `listUsers(): Promise<(AccessUser & { status: AccessStatus; grants: Grant[] })[]>`
  - `approve(sub: string): Promise<AccessUser>`
  - `removeMember(sub: string): Promise<AccessUser>`
  - `dismiss(sub: string): Promise<AccessUser>`
  - `grantAction(p: { sub: string; action: MeteredAction; limit: number; expiresInDays: number; note?: string; now: number }): Promise<{ user: AccessUser; grant: Grant }>`
  - `revokeGrant(sub: string, action: MeteredAction): Promise<AccessUser>`

- [ ] **Step 1: Install**

```bash
cd web && npm install @aws-sdk/client-cognito-identity-provider
```

- [ ] **Step 2: Write the failing tests**

`web/lib/access-admin.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

vi.mock("./authz/grants", () => ({ getGrantStore: vi.fn() }));
import { getGrantStore } from "./authz/grants";
import { AccessError, approve, dismiss, grantAction, listUsers, removeMember, revokeGrant } from "./access-admin";

const cognito = mockClient(CognitoIdentityProviderClient);
const store = { list: vi.fn(), put: vi.fn(), remove: vi.fn(), removeAll: vi.fn() };

const cognitoUser = (sub: string, username = `Google_${sub}`) => ({
  Username: username,
  UserCreateDate: new Date("2026-10-01T00:00:00Z"),
  Attributes: [
    { Name: "sub", Value: sub },
    { Name: "email", Value: `${sub}@example.com` },
  ],
});

function groupsOf(map: Record<string, string[]>) {
  cognito.on(AdminListGroupsForUserCommand).callsFake((input) => ({
    Groups: (map[input.Username] ?? []).map((GroupName) => ({ GroupName })),
  }));
}

beforeEach(() => {
  cognito.reset();
  vi.clearAllMocks();
  process.env.COGNITO_USER_POOL_ID = "us-east-1_pool";
  process.env.APP_AWS_REGION = "us-east-1";
  vi.mocked(getGrantStore).mockReturnValue(store as never);
  store.list.mockResolvedValue([]);
});

describe("listUsers", () => {
  it("returns every user with a status and, for members, their grants", async () => {
    cognito.on(ListUsersCommand).resolves({ Users: [cognitoUser("o", "owner-uuid"), cognitoUser("f"), cognitoUser("p")] });
    groupsOf({ "owner-uuid": ["owner"], Google_f: ["friends", "us-east-1_pool_Google"], Google_p: ["us-east-1_pool_Google"] });
    store.list.mockImplementation(async (sub: string) => (sub === "f" ? [{ action: "newsdesk:ask" }] : []));

    const users = await listUsers();
    expect(users.map((u) => [u.sub, u.status, u.grants.length])).toEqual([
      ["o", "owner", 0],
      ["f", "member", 1],
      ["p", "pending", 0],
    ]);
    expect(users[1]).toMatchObject({ username: "Google_f", email: "f@example.com", createdAt: "2026-10-01T00:00:00.000Z" });
  });

  it("follows pagination", async () => {
    cognito
      .on(ListUsersCommand)
      .resolvesOnce({ Users: [cognitoUser("a")], PaginationToken: "next" })
      .resolvesOnce({ Users: [cognitoUser("b")] });
    groupsOf({});
    expect((await listUsers()).map((u) => u.sub)).toEqual(["a", "b"]);
  });
});

describe("changes", () => {
  function only(sub: string, groups: string[]) {
    cognito.on(ListUsersCommand, { Filter: `sub = "${sub}"` }).resolves({ Users: [cognitoUser(sub)] });
    groupsOf({ [`Google_${sub}`]: groups });
  }

  it("approve adds a pending user to friends", async () => {
    only("p", []);
    cognito.on(AdminAddUserToGroupCommand).resolves({});
    expect((await approve("p")).email).toBe("p@example.com");
    expect(cognito.commandCalls(AdminAddUserToGroupCommand)[0].args[0].input).toEqual({
      UserPoolId: "us-east-1_pool",
      Username: "Google_p",
      GroupName: "friends",
    });
  });

  it("removeMember removes the group, signs out everywhere and deletes grants", async () => {
    only("f", ["friends"]);
    cognito.on(AdminRemoveUserFromGroupCommand).resolves({});
    cognito.on(AdminUserGlobalSignOutCommand).resolves({});
    await removeMember("f");
    expect(cognito.commandCalls(AdminRemoveUserFromGroupCommand)).toHaveLength(1);
    expect(cognito.commandCalls(AdminUserGlobalSignOutCommand)).toHaveLength(1);
    expect(store.removeAll).toHaveBeenCalledWith("f");
  });

  it("dismiss deletes a pending user", async () => {
    only("p", ["us-east-1_pool_Google"]);
    cognito.on(AdminDeleteUserCommand).resolves({});
    await dismiss("p");
    expect(cognito.commandCalls(AdminDeleteUserCommand)).toHaveLength(1);
  });

  it("grantAction writes a fresh row for a member", async () => {
    only("f", ["friends"]);
    const { grant } = await grantAction({ sub: "f", action: "newsdesk:ask", limit: 20, expiresInDays: 7, note: "emailed", now: 1000 });
    expect(grant).toEqual({
      sub: "f",
      action: "newsdesk:ask",
      email: "f@example.com",
      limit: 20,
      used: 0,
      expiresAt: 1000 + 7 * 86400,
      grantedAt: 1000,
      note: "emailed",
    });
    expect(store.put).toHaveBeenCalledWith(grant);
  });

  it("revokeGrant deletes one row", async () => {
    only("f", ["friends"]);
    await revokeGrant("f", "newsdesk:ask");
    expect(store.remove).toHaveBeenCalledWith("f", "newsdesk:ask");
  });

  // The owner can't be locked out from this page.
  it.each([
    ["approve", () => approve("o")],
    ["removeMember", () => removeMember("o")],
    ["dismiss", () => dismiss("o")],
    ["grantAction", () => grantAction({ sub: "o", action: "newsdesk:ask", limit: 1, expiresInDays: 1, now: 0 })],
    ["revokeGrant", () => revokeGrant("o", "newsdesk:ask")],
  ])("%s refuses the owner with 409 and changes nothing", async (_label, run) => {
    only("o", ["owner"]);
    await expect(run()).rejects.toMatchObject({ status: 409 });
    expect(cognito.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0);
    expect(cognito.commandCalls(AdminRemoveUserFromGroupCommand)).toHaveLength(0);
    expect(cognito.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
    expect(store.put).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });

  it.each([
    ["dismiss a member", () => dismiss("f"), ["friends"]],
    ["approve a member again", () => approve("f"), ["friends"]],
    ["grant to a pending user", () => grantAction({ sub: "f", action: "newsdesk:ask", limit: 1, expiresInDays: 1, now: 0 }), []],
    ["remove a pending user", () => removeMember("f"), []],
  ])("refuses to %s with 409", async (_label, run, groups) => {
    only("f", groups as string[]);
    await expect(run()).rejects.toMatchObject({ status: 409 });
  });

  it("answers 404 for an unknown sub", async () => {
    cognito.on(ListUsersCommand).resolves({ Users: [] });
    await expect(approve("nobody")).rejects.toBeInstanceOf(AccessError);
    await expect(approve("nobody")).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd web && npx vitest run lib/access-admin.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`web/lib/access-admin.ts`:

```ts
import {
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { awsCredentials } from "./aws";
import { getGrantStore, type Grant } from "./authz/grants";
import type { MeteredAction } from "./route-gate";

export type AccessUser = { sub: string; username: string; email: string; createdAt: string; groups: string[] };
export type AccessStatus = "owner" | "member" | "pending";

export class AccessError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

let client: CognitoIdentityProviderClient | null = null;
function cognito(): CognitoIdentityProviderClient {
  return (client ??= new CognitoIdentityProviderClient({ region: process.env.APP_AWS_REGION!, ...awsCredentials() }));
}
const pool = () => process.env.COGNITO_USER_POOL_ID!;

export function statusOf(user: AccessUser): AccessStatus {
  if (user.groups.includes("owner")) return "owner";
  if (user.groups.includes("friends")) return "member";
  return "pending";
}

async function withGroups(user: UserType): Promise<AccessUser> {
  const attr = (name: string) => user.Attributes?.find((a) => a.Name === name)?.Value ?? "";
  const out = await cognito().send(new AdminListGroupsForUserCommand({ UserPoolId: pool(), Username: user.Username! }));
  return {
    sub: attr("sub"),
    username: user.Username!,
    email: attr("email"),
    createdAt: user.UserCreateDate?.toISOString() ?? "",
    groups: (out.Groups ?? []).map((g) => g.GroupName!).filter(Boolean),
  };
}

export async function listUsers(): Promise<(AccessUser & { status: AccessStatus; grants: Grant[] })[]> {
  const users: UserType[] = [];
  let token: string | undefined;
  do {
    const page = await cognito().send(new ListUsersCommand({ UserPoolId: pool(), PaginationToken: token }));
    users.push(...(page.Users ?? []));
    token = page.PaginationToken;
  } while (token);

  return Promise.all(
    users.map(async (raw) => {
      const user = await withGroups(raw);
      const status = statusOf(user);
      return { ...user, status, grants: status === "member" ? await getGrantStore().list(user.sub) : [] };
    }),
  );
}

// The routes are keyed by sub, as the grants table is; the admin API wants the
// username, which for a Google user is "Google_<id>".
async function findBySub(sub: string): Promise<AccessUser> {
  const out = await cognito().send(new ListUsersCommand({ UserPoolId: pool(), Filter: `sub = "${sub.replace(/"/g, "")}"`, Limit: 1 }));
  const raw = out.Users?.[0];
  if (!raw) throw new AccessError("no such user", 404);
  return withGroups(raw);
}

async function requireStatus(sub: string, expected: AccessStatus): Promise<AccessUser> {
  const user = await findBySub(sub);
  const status = statusOf(user);
  if (status === "owner") throw new AccessError("the owner can't be changed here", 409);
  if (status !== expected) throw new AccessError(`expected a ${expected} user, found a ${status} one`, 409);
  return user;
}

export async function approve(sub: string): Promise<AccessUser> {
  const user = await requireStatus(sub, "pending");
  await cognito().send(new AdminAddUserToGroupCommand({ UserPoolId: pool(), Username: user.username, GroupName: "friends" }));
  return user;
}

export async function removeMember(sub: string): Promise<AccessUser> {
  const user = await requireStatus(sub, "member");
  await cognito().send(new AdminRemoveUserFromGroupCommand({ UserPoolId: pool(), Username: user.username, GroupName: "friends" }));
  // Revokes their refresh tokens: access ends when the current ID token expires.
  await cognito().send(new AdminUserGlobalSignOutCommand({ UserPoolId: pool(), Username: user.username }));
  await getGrantStore().removeAll(user.sub);
  return user;
}

export async function dismiss(sub: string): Promise<AccessUser> {
  const user = await requireStatus(sub, "pending");
  await cognito().send(new AdminDeleteUserCommand({ UserPoolId: pool(), Username: user.username }));
  return user;
}

export async function grantAction(p: {
  sub: string;
  action: MeteredAction;
  limit: number;
  expiresInDays: number;
  note?: string;
  now: number;
}): Promise<{ user: AccessUser; grant: Grant }> {
  const user = await requireStatus(p.sub, "member");
  const grant: Grant = {
    sub: user.sub,
    action: p.action,
    email: user.email,
    limit: p.limit,
    used: 0,
    expiresAt: p.now + p.expiresInDays * 86400,
    grantedAt: p.now,
    ...(p.note ? { note: p.note } : {}),
  };
  await getGrantStore().put(grant);
  return { user, grant };
}

export async function revokeGrant(sub: string, action: MeteredAction): Promise<AccessUser> {
  const user = await requireStatus(sub, "member");
  await getGrantStore().remove(user.sub, action);
  return user;
}
```

- [ ] **Step 5: Run and commit**

Run: `cd web && npx vitest run lib/access-admin.test.ts`
Expected: PASS.

```bash
git add web/lib/access-admin.ts web/lib/access-admin.test.ts web/package.json web/package-lock.json
git commit -m "feat(access): Cognito directory for the Access page (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 6: `/api/access/*` routes, gating and the Access tool entry

**Files:**
- Create: `web/lib/access-api.ts` (shared: body schemas, error mapping, audit log)
- Create: `web/app/api/access/users/route.ts`, `web/app/api/access/members/route.ts`, `web/app/api/access/members/[sub]/route.ts`, `web/app/api/access/pending/[sub]/route.ts`, `web/app/api/access/grants/route.ts`, `web/app/api/access/grants/[sub]/[action]/route.ts`
- Test: `web/app/api/access/routes.test.ts`
- Modify: `web/lib/route-gate.ts`, `web/lib/route-gate.test.ts`, `web/lib/site/commands.ts`

**Interfaces:**
- Consumes: Task 5's functions; `readSession` (part 1).
- Produces: the six routes; `actingEmail(): Promise<string>`, `audit(entry: Record<string, unknown>): void`, `respond(run: () => Promise<Response>): Promise<Response>`. Part 3 edits the members/grants routes to send email.

- [ ] **Step 1: Gate and map the routes; add the tool**

In `web/lib/route-gate.ts`:
- add `"/api/access"` to `GATED_PREFIXES` after `"/api/news-desk"`
- add two rows at the end of `ROUTE_ACTIONS`:

```ts
  { methods: PAGE, path: /^\/tools\/access-admin$/, tool: "access-admin", action: "access:manage" },
  { methods: "*", path: /^\/api\/access(\/.*)?$/, tool: "access-admin", action: "access:manage" },
```

- add to `TOOLS`, last:

```ts
  {
    id: "access-admin",
    href: "/tools/access-admin",
    name: "Access",
    kind: "Site",
    blurb: "Approve people who asked for access, and grant or revoke the actions that cost money.",
    pageAction: "access:manage",
  },
```

In `web/lib/site/commands.ts`, after the `open-content-editor` row:

```ts
  {
    id: "open-access-admin",
    label: "open access-admin",
    hint: "Approve people and grant metered actions",
    run: (ctx) => ctx.push("/tools/access-admin"),
  },
```

In `web/lib/route-gate.test.ts`'s `isGatedPath` table add `["/api/access/users", true]` and `["/tools/access-admin", true]`, and in `actionFor`'s table:

```ts
    ["GET", "/tools/access-admin", "access-admin", "access:manage", false],
    ["PUT", "/api/access/grants", "access-admin", "access:manage", false],
    ["DELETE", "/api/access/grants/u1/newsdesk%3Aask", "access-admin", "access:manage", false],
```

- [ ] **Step 2: Write the failing route tests**

`web/app/api/access/routes.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/access-admin", async (importOriginal) => ({
  AccessError: (await importOriginal<typeof import("@/lib/access-admin")>()).AccessError,
  listUsers: vi.fn(),
  approve: vi.fn(),
  removeMember: vi.fn(),
  dismiss: vi.fn(),
  grantAction: vi.fn(),
  revokeGrant: vi.fn(),
}));
vi.mock("@/lib/access-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access-api")>()),
  actingEmail: vi.fn(async () => "owner@example.com"),
}));

import { AccessError, approve, dismiss, grantAction, listUsers, removeMember, revokeGrant } from "@/lib/access-admin";
import { GET as users } from "./users/route";
import { POST as approveRoute } from "./members/route";
import { DELETE as removeRoute } from "./members/[sub]/route";
import { DELETE as dismissRoute } from "./pending/[sub]/route";
import { PUT as grantRoute } from "./grants/route";
import { DELETE as revokeRoute } from "./grants/[sub]/[action]/route";

const user = { sub: "u1", username: "Google_1", email: "a@example.com", createdAt: "", groups: [] };
const json = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("/api/access", () => {
  it("GET users returns the directory", async () => {
    vi.mocked(listUsers).mockResolvedValue([{ ...user, status: "pending", grants: [] }]);
    expect(await (await users()).json()).toEqual({ users: [{ ...user, status: "pending", grants: [] }] });
  });

  it("POST members approves and logs who did it", async () => {
    vi.mocked(approve).mockResolvedValue(user);
    const res = await approveRoute(json({ sub: "u1" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(approve).toHaveBeenCalledWith("u1");
    expect(console.info).toHaveBeenCalledWith(
      JSON.stringify({ event: "access", by: "owner@example.com", op: "approve", target: "a@example.com" }),
    );
  });

  it("DELETE members/[sub] removes, DELETE pending/[sub] dismisses", async () => {
    vi.mocked(removeMember).mockResolvedValue(user);
    vi.mocked(dismiss).mockResolvedValue(user);
    expect((await removeRoute(new Request("http://x"), params({ sub: "u1" }))).status).toBe(200);
    expect((await dismissRoute(new Request("http://x"), params({ sub: "u1" }))).status).toBe(200);
    expect(removeMember).toHaveBeenCalledWith("u1");
    expect(dismiss).toHaveBeenCalledWith("u1");
  });

  it("PUT grants validates, applies defaults and grants", async () => {
    vi.mocked(grantAction).mockResolvedValue({ user, grant: { expiresAt: 99 } as never });
    const res = await grantRoute(json({ sub: "u1", action: "newsdesk:ask" }));
    expect(res.status).toBe(200);
    expect(grantAction).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "u1", action: "newsdesk:ask", limit: 20, expiresInDays: 7, now: expect.any(Number) }),
    );
  });

  it.each([
    [{ sub: "u1", action: "resume:extract" }],
    [{ sub: "u1", action: "newsdesk:ask", limit: 0 }],
    [{ sub: "u1", action: "newsdesk:ask", limit: 1001 }],
    [{ sub: "u1", action: "newsdesk:ask", expiresInDays: 91 }],
    [{ sub: "u1", action: "newsdesk:ask", note: "x".repeat(201) }],
    [{ action: "newsdesk:ask" }],
  ])("PUT grants rejects %j with 400", async (body) => {
    const res = await grantRoute(json(body));
    expect(res.status).toBe(400);
    expect(grantAction).not.toHaveBeenCalled();
  });

  it("DELETE grants/[sub]/[action] receives the decoded action", async () => {
    vi.mocked(revokeGrant).mockResolvedValue(user);
    // Next decodes route params, so "newsdesk%3Aask" arrives as "newsdesk:ask".
    const res = await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "newsdesk:ask" }));
    expect(res.status).toBe(200);
    expect(revokeGrant).toHaveBeenCalledWith("u1", "newsdesk:ask");
  });

  it("DELETE grants rejects an action that isn't metered", async () => {
    const res = await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "keystatic:use" }));
    expect(res.status).toBe(400);
  });

  it.each([
    [new AccessError("the owner can't be changed here", 409), 409],
    [new AccessError("no such user", 404), 404],
  ])("maps %s to its status", async (err, status) => {
    vi.mocked(approve).mockRejectedValue(err);
    const res = await approveRoute(json({ sub: "u1" }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: err.message });
  });

  it("answers 500 for an unexpected failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(approve).mockRejectedValue(new Error("AccessDeniedException"));
    const res = await approveRoute(json({ sub: "u1" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "the change failed; nothing was changed" });
  });
});
```

The 500 message says nothing was changed; that holds for approve, dismiss and single-row grant changes. `removeMember` makes three calls; if the second or third fails, the member is out of the group but may keep a refresh token or grant rows. The page shows the error and the owner retries, which is safe because each call is idempotent except the group check (the retry then answers 409 "expected a member"). Note this in the route's comment.

- [ ] **Step 3: Run to see them fail**

Run: `cd web && npx vitest run app/api/access lib/route-gate.test.ts lib/route-coverage.test.ts`
Expected: the route tests FAIL (modules missing); the route-gate tests PASS.

- [ ] **Step 4: Implement the shared helpers**

`web/lib/access-api.ts`:

```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "./auth";
import { AccessError } from "./access-admin";
import { METERED_ACTIONS } from "./route-gate";

export const meteredAction = z.enum(METERED_ACTIONS);

export const subBody = z.object({ sub: z.string().min(1).max(128) });

export const grantBody = z.object({
  sub: z.string().min(1).max(128),
  action: meteredAction,
  limit: z.number().int().min(1).max(1000).default(20),
  expiresInDays: z.number().int().min(1).max(90).default(7),
  note: z.string().trim().max(200).optional(),
});

/** Who made the change, for the audit line. The proxy already checked access:manage. */
export async function actingEmail(): Promise<string> {
  const secret = process.env.COOKIE_SECRET;
  const session = secret ? readSession(await cookies(), secret) : null;
  return session?.email ?? session?.sub ?? "unknown";
}

export function audit(entry: Record<string, unknown>): void {
  console.info(JSON.stringify({ event: "access", ...entry }));
}

export async function respond(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("access: change failed", err);
    return NextResponse.json({ error: "the change failed; nothing was changed" }, { status: 500 });
  }
}

export function badRequest(): Response {
  return NextResponse.json({ error: "invalid request" }, { status: 400 });
}
```

- [ ] **Step 5: Implement the routes**

`web/app/api/access/users/route.ts`:

```ts
import { NextResponse } from "next/server";
import { listUsers } from "@/lib/access-admin";
import { respond } from "@/lib/access-api";

export const dynamic = "force-dynamic";

export async function GET() {
  return respond(async () => NextResponse.json({ users: await listUsers() }));
}
```

`web/app/api/access/members/route.ts`:

```ts
import { NextResponse } from "next/server";
import { approve } from "@/lib/access-admin";
import { actingEmail, audit, badRequest, respond, subBody } from "@/lib/access-api";

export async function POST(request: Request) {
  const parsed = subBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest();
  return respond(async () => {
    const user = await approve(parsed.data.sub);
    audit({ by: await actingEmail(), op: "approve", target: user.email });
    return NextResponse.json({ ok: true });
  });
}
```

`web/app/api/access/members/[sub]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { removeMember } from "@/lib/access-admin";
import { actingEmail, audit, respond } from "@/lib/access-api";

// Three calls: leave the group, sign out everywhere, delete grants. If a later
// one fails the member is already out of the group; a retry answers 409, and
// the refresh token still expires within 7 days and grants within their expiry.
export async function DELETE(_request: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  return respond(async () => {
    const user = await removeMember(sub);
    audit({ by: await actingEmail(), op: "remove", target: user.email });
    return NextResponse.json({ ok: true });
  });
}
```

`web/app/api/access/pending/[sub]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { dismiss } from "@/lib/access-admin";
import { actingEmail, audit, respond } from "@/lib/access-api";

export async function DELETE(_request: Request, { params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  return respond(async () => {
    const user = await dismiss(sub);
    audit({ by: await actingEmail(), op: "dismiss", target: user.email });
    return NextResponse.json({ ok: true });
  });
}
```

`web/app/api/access/grants/route.ts`:

```ts
import { NextResponse } from "next/server";
import { grantAction } from "@/lib/access-admin";
import { actingEmail, audit, badRequest, grantBody, respond } from "@/lib/access-api";

export async function PUT(request: Request) {
  const parsed = grantBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest();
  return respond(async () => {
    const { user, grant } = await grantAction({ ...parsed.data, now: Math.floor(Date.now() / 1000) });
    audit({
      by: await actingEmail(),
      op: "grant",
      target: user.email,
      action: grant.action,
      limit: grant.limit,
      expiresAt: grant.expiresAt,
    });
    return NextResponse.json({ ok: true });
  });
}
```

`web/app/api/access/grants/[sub]/[action]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { revokeGrant } from "@/lib/access-admin";
import { actingEmail, audit, badRequest, meteredAction, respond } from "@/lib/access-api";

export async function DELETE(_request: Request, { params }: { params: Promise<{ sub: string; action: string }> }) {
  const { sub, action } = await params;
  const parsed = meteredAction.safeParse(action);
  if (!parsed.success) return badRequest();
  return respond(async () => {
    const user = await revokeGrant(sub, parsed.data);
    audit({ by: await actingEmail(), op: "revoke", target: user.email, action: parsed.data });
    return NextResponse.json({ ok: true });
  });
}
```

- [ ] **Step 6: Run and commit**

Run: `cd web && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS. `route-coverage.test.ts` now also checks the six new routes and the `access-admin` page once Task 7 adds it; until then, the `TOOLS` test in `route-gate.test.ts` maps `/tools/access-admin` through the new row.

```bash
git add web/lib/access-api.ts web/app/api/access web/lib/route-gate.ts web/lib/route-gate.test.ts web/lib/site/commands.ts
git commit -m "feat(access): owner-only Access API (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 7: The Access page

**Files:**
- Create: `web/app/tools/access-admin/page.tsx`, `web/components/access/AccessAdmin.tsx`
- Test: `web/components/access/AccessAdmin.test.tsx`

**Interfaces:**
- Consumes: `GET /api/access/users` → `{ users: (AccessUser & { status; grants })[] }`; the change routes (Task 6); `METERED_LABELS` (Task 4).
- Produces: the page. Part 3 reads `emailError` from change responses and shows it.

- [ ] **Step 1: Write the failing tests**

`web/components/access/AccessAdmin.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccessAdmin } from "./AccessAdmin";

const directory = {
  users: [
    { sub: "o", username: "o", email: "owner@example.com", createdAt: "2026-09-28T00:00:00Z", groups: ["owner"], status: "owner", grants: [] },
    {
      sub: "f", username: "Google_f", email: "friend@example.com", createdAt: "2026-10-01T00:00:00Z", groups: ["friends"], status: "member",
      grants: [{ sub: "f", action: "newsdesk:ask", email: "friend@example.com", limit: 20, used: 13, expiresAt: 1_791_504_000, grantedAt: 0 }],
    },
    { sub: "p", username: "Google_p", email: "pending@example.com", createdAt: "2026-10-02T00:00:00Z", groups: [], status: "pending", grants: [] },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => (url === "/api/access/users" && !init?.method ? directory : { ok: true }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("AccessAdmin", () => {
  it("splits users into Pending, Members and You", async () => {
    render(<AccessAdmin />);
    const pending = await screen.findByRole("region", { name: "Pending" });
    expect(within(pending).getByText("pending@example.com")).toBeInTheDocument();
    const members = screen.getByRole("region", { name: "Members" });
    expect(within(members).getByText("friend@example.com")).toBeInTheDocument();
    expect(within(members).getByText(/News Desk ask: 7 of 20 left/)).toBeInTheDocument();
    const you = screen.getByRole("region", { name: "You" });
    expect(within(you).getByText("owner@example.com")).toBeInTheDocument();
    expect(within(you).queryByRole("button")).not.toBeInTheDocument();
  });

  it("approves a pending user and reloads", async () => {
    render(<AccessAdmin />);
    await userEvent.click(await screen.findByRole("button", { name: "Approve pending@example.com" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/access/members", expect.objectContaining({ method: "POST", body: JSON.stringify({ sub: "p" }) }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === "/api/access/users")).toHaveLength(2));
  });

  it("grants a metered action with the form's values", async () => {
    render(<AccessAdmin />);
    const form = await screen.findByRole("form", { name: "Grant to friend@example.com" });
    await userEvent.selectOptions(within(form).getByLabelText("Action"), "looper:process");
    await userEvent.clear(within(form).getByLabelText("Uses"));
    await userEvent.type(within(form).getByLabelText("Uses"), "5");
    await userEvent.click(within(form).getByRole("button", { name: "Grant" }));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(call[0]).toBe("/api/access/grants");
    expect(JSON.parse(call[1].body)).toEqual({ sub: "f", action: "looper:process", limit: 5, expiresInDays: 7, note: "" });
  });

  it("revokes a grant with the action encoded in the URL", async () => {
    render(<AccessAdmin />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke News Desk ask for friend@example.com" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/access/grants/f/newsdesk%3Aask", expect.objectContaining({ method: "DELETE" }));
  });

  it("shows the API's error message", async () => {
    render(<AccessAdmin />);
    await screen.findByText("pending@example.com");
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "expected a pending user, found a member one" }) });
    await userEvent.click(screen.getByRole("button", { name: "Dismiss pending@example.com" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("expected a pending user, found a member one");
  });

  it("says so when the directory can't be loaded", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "the change failed; nothing was changed" }) });
    render(<AccessAdmin />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load users");
  });
});
```

If `@testing-library/user-event` isn't in `web/package.json`, install it: `npm install --save-dev @testing-library/user-event`.

- [ ] **Step 2: Run to see them fail**

Run: `cd web && npx vitest run components/access`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the component**

`web/components/access/AccessAdmin.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import type { AccessStatus, AccessUser } from "../../lib/access-admin";
import type { Grant } from "../../lib/authz/grants";
import { METERED_LABELS } from "../../lib/authz/my-grants";
import { METERED_ACTIONS, type MeteredAction } from "../../lib/route-gate";

type Row = AccessUser & { status: AccessStatus; grants: Grant[] };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const until = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export function AccessAdmin() {
  const [users, setUsers] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/access/users");
    if (!res.ok) {
      setError("Couldn't load users.");
      return;
    }
    setUsers((await res.json()).users);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(url: string, init: RequestInit) {
    setError(null);
    setNotice(null);
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "The change failed.");
      return;
    }
    // Part 3 fills this in when the change saved but the email didn't send.
    if (body.emailError) setNotice(`Saved, but the email failed: ${body.emailError}`);
    await load();
  }

  const by = (status: AccessStatus) => (users ?? []).filter((u) => u.status === status);

  return (
    <div className="mt-10 flex flex-col gap-12">
      {error ? <p role="alert" className="text-sm text-accent">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-fg">{notice}</p> : null}

      <section aria-label="Pending">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted">Pending</h2>
        <ul className="mt-3 flex flex-col">
          {by("pending").map((u) => (
            <li key={u.sub} className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-line py-4">
              <span className="font-medium">{u.email}</span>
              <span className="text-sm text-muted">first signed in {day(u.createdAt)}</span>
              <span className="ml-auto flex gap-3 text-sm">
                <button aria-label={`Approve ${u.email}`} className="text-accent hover:text-fg"
                  onClick={() => change("/api/access/members", { method: "POST", body: JSON.stringify({ sub: u.sub }) })}>
                  Approve
                </button>
                <button aria-label={`Dismiss ${u.email}`} className="text-muted hover:text-fg"
                  onClick={() => change(`/api/access/pending/${encodeURIComponent(u.sub)}`, { method: "DELETE" })}>
                  Dismiss
                </button>
              </span>
            </li>
          ))}
          {users && by("pending").length === 0 ? <li className="py-4 text-sm text-muted">Nobody is waiting.</li> : null}
        </ul>
      </section>

      <section aria-label="Members">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted">Members</h2>
        <ul className="mt-3 flex flex-col">
          {by("member").map((u) => (
            <li key={u.sub} className="border-b border-line py-5">
              <div className="flex flex-wrap items-baseline gap-x-4">
                <span className="font-medium">{u.email}</span>
                <button aria-label={`Remove ${u.email}`} className="ml-auto text-sm text-muted hover:text-fg"
                  onClick={() => change(`/api/access/members/${encodeURIComponent(u.sub)}`, { method: "DELETE" })}>
                  Remove
                </button>
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {u.grants.map((g) => (
                  <li key={g.action} className="flex gap-3">
                    <span>
                      {METERED_LABELS[g.action]}: {g.limit - g.used} of {g.limit} left, expires {until(g.expiresAt)}
                    </span>
                    <button aria-label={`Revoke ${METERED_LABELS[g.action]} for ${u.email}`} className="text-muted hover:text-fg"
                      onClick={() =>
                        change(`/api/access/grants/${encodeURIComponent(u.sub)}/${encodeURIComponent(g.action)}`, { method: "DELETE" })
                      }>
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
              <GrantForm email={u.email} onGrant={(values) => change("/api/access/grants", { method: "PUT", body: JSON.stringify({ sub: u.sub, ...values }) })} />
            </li>
          ))}
          {users && by("member").length === 0 ? <li className="py-4 text-sm text-muted">No members yet.</li> : null}
        </ul>
      </section>

      <section aria-label="You">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted">You</h2>
        <ul className="mt-3">
          {by("owner").map((u) => (
            <li key={u.sub} className="py-2 text-sm">
              <span className="font-medium">{u.email}</span> <span className="text-muted">— owner, not editable here</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function GrantForm({
  email,
  onGrant,
}: {
  email: string;
  onGrant: (values: { action: MeteredAction; limit: number; expiresInDays: number; note: string }) => void;
}) {
  const [action, setAction] = useState<MeteredAction>("newsdesk:ask");
  const [limit, setLimit] = useState("20");
  const [days, setDays] = useState("7");
  const [note, setNote] = useState("");
  const id = email.replace(/[^a-z0-9]/gi, "-");

  return (
    <form
      aria-label={`Grant to ${email}`}
      className="mt-3 flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onGrant({ action, limit: Number(limit), expiresInDays: Number(days), note });
      }}
    >
      <label className="flex flex-col gap-1" htmlFor={`${id}-action`}>
        <span className="text-muted">Action</span>
        <select id={`${id}-action`} value={action} onChange={(e) => setAction(e.target.value as MeteredAction)} className="border border-line bg-bg px-2 py-1">
          {METERED_ACTIONS.map((a) => (
            <option key={a} value={a}>{METERED_LABELS[a]}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${id}-limit`}>
        <span className="text-muted">Uses</span>
        <input id={`${id}-limit`} type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(e.target.value)} className="w-20 border border-line bg-bg px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${id}-days`}>
        <span className="text-muted">Days</span>
        <input id={`${id}-days`} type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="w-16 border border-line bg-bg px-2 py-1" />
      </label>
      <label className="flex flex-1 flex-col gap-1" htmlFor={`${id}-note`}>
        <span className="text-muted">Note</span>
        <input id={`${id}-note`} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className="border border-line bg-bg px-2 py-1" />
      </label>
      <button type="submit" className="text-accent hover:text-fg">Grant</button>
    </form>
  );
}
```

`getByLabelText("Uses")` matches through the `<label>`'s text; if it doesn't in this Testing Library version, add `aria-label="Uses"` (and the same for Action, Days, Note) to the inputs.

- [ ] **Step 4: Implement the page**

`web/app/tools/access-admin/page.tsx`:

```tsx
import Link from "next/link";
import { CommandBar } from "../../../components/site/CommandBar";
import { AccessAdmin } from "../../../components/access/AccessAdmin";

// Owner only: the proxy checks access:manage before this renders.
export default function AccessAdminPage() {
  return (
    <div className="flex min-h-screen flex-col font-ui">
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link href="/tools" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg">
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Tools
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">Access</span>
      </header>
      <main className="flex flex-1 flex-col px-5 py-14 sm:px-10">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Owner</p>
        <h1 className="mt-3 font-display text-5xl leading-[0.95] sm:text-[5.25rem]">Access</h1>
        <div className="mt-5 border-b-2 border-rule-heavy" />
        <p className="mt-[18px] max-w-[52ch] text-base leading-relaxed text-muted">
          Approve people who signed in and wrote to access@ashutosh-pandey.com, and grant them the actions that cost money.
        </p>
        <AccessAdmin />
      </main>
      <CommandBar />
    </div>
  );
}
```

- [ ] **Step 5: Run and commit**

Run: `cd web && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS, including `route-coverage.test.ts` for the new page.

```bash
git add web/app/tools/access-admin web/components/access web/package.json web/package-lock.json
git commit -m "feat(access): Access page to approve people and grant metered actions (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 8: e2e, docs, CHANGELOG, PR

**Files:**
- Modify: `web/e2e/access.spec.ts`, `web/e2e/tools.spec.ts` (the hub list now includes Access)
- Modify: `.claude/rules/web.md`, `CHANGELOG.md`

- [ ] **Step 1: Extend the e2e spec**

Append to `web/e2e/access.spec.ts`:

```ts
test("the owner can open the Access page; a friend can't", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/tools/access-admin");
  await expect(page.getByRole("heading", { level: 1, name: "Access" })).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, baseURL!, "friends");
  await page.goto("/tools/access-admin");
  await expect(page).toHaveURL(/\/access-denied\?reason=forbidden&tool=access-admin&action=access%3Amanage$/);
  const api = await page.request.get("/api/access/users");
  expect(api.status()).toBe(403);
});
```

Under e2e there is no Cognito, so the page itself shows "Couldn't load users."; the flows are covered by Vitest in Tasks 5–7. In `web/e2e/tools.spec.ts`, add `["Access", "/tools/access-admin"]` to the hub's owner list.

- [ ] **Step 2: Run everything**

```bash
cd web && npm test && npm run lint && npx tsc --noEmit
KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build && npm run test:e2e
```

Expected: all green.

- [ ] **Step 3: Docs and CHANGELOG**

- `.claude/rules/web.md`: after the session bullet, add: "Metered actions (`METERED_ACTIONS` in `route-gate.ts`) need a row in the `site-access-grants` DynamoDB table (`web/lib/authz/grants.ts`). The proxy reads it for a friend, passes `remaining`/`expiresAt` to Verified Permissions as `context.grant`, and on allow consumes one use with a conditional update; the owner is never read or counted. Under `AUTHZ_MODE=local` the grant store is an in-memory map. `/tools/access-admin` and `/api/access/*` (owner only, `access:manage`) approve people into the `friends` group and make grants through `web/lib/access-admin.ts`, which refuses any change to an `owner` member with 409."
- `CHANGELOG.md` under `[Unreleased]` → `### Added`:

```markdown
- Access page at `/tools/access-admin` (owner only): approve people who signed in, remove members, and grant or revoke the actions that cost money (News Desk ask and refresh, BGM Looper processing), each with a number of uses and an expiry. The hub shows each friend their remaining uses (#300).
```

- [ ] **Step 4: Commit, push, PR**

```bash
cd /e/Personal/looper
git add web/e2e .claude/rules/web.md CHANGELOG.md
git commit -m "docs: access grants and the Access page (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/access-control-grants
gh pr create --base dev --title "feat: access grants and the Access page (#300)" --body "$(cat <<'EOF'
Part 2b of #300 (plan: docs/superpowers/plans/2026-09-29-access-control-grants.md).

- Uses the `site-access-grants` table applied by the infra PR (Task 1)
- Metered actions read the grant, pass it to Verified Permissions, and consume one use with a conditional update; denials say no_grant, quota_exhausted or grant_expired
- /tools/access-admin and /api/access/* (owner only): approve, dismiss, remove, grant, revoke; the owner can't be changed here
- The hub shows a friend's remaining uses

Refs #300
EOF
)"
```

Then invoke the `merging-a-pr` skill and follow it to merge.

- [ ] **Step 5: Manual check on `dev` after deploy**

1. Sign in with a second Google account in a private window → `/access-requested`.
2. As the owner, open `/tools/access-admin` → the account is under Pending. Approve it.
3. In the private window, sign in again → the hub lists BGM Looper, Money Planner and News Desk.
4. As the owner, grant it News Desk ask with 2 uses.
5. In the private window, sign in again or wait for the next refresh, then ask two questions → both answer; a third → "You've used every run your grant allowed." (the chat shows the API error).
6. As the owner, remove the member. Within 15 minutes the private window's next request goes to `/login` (refresh revoked) and, after signing in again, to `/access-requested`.
