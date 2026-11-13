# Access control, part 3: domain email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Access page emails invitees from `access@ashutosh-pandey.com` when they're approved, granted, or lose access. Mail to `access@` lands in the owner's Zoho inbox, where it is an alias of the owner's mailbox (#403).

**Architecture:** The Access API's change routes send transactional mail through SESv2 `SendEmail`; a failed send doesn't undo the change and is reported on the page. Nothing in AWS receives mail: Zoho owns the apex MX (`infra/prod/account/email.tf`, #403).

**Tech Stack:** SESv2 sending, `@aws-sdk/client-sesv2`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-access-control-design.md` (§7, §8 `email.tf`, §11 PR 3, §12). Depends on parts 1 and 2 (`2026-09-29-access-control-authorization.md`, `2026-09-29-access-control-grants.md`) being merged into `dev`.

## Global Constraints

- Everything in parts 1 and 2's Global Constraints still holds.
- Two PRs into `dev`, in order, each squash-merged after the `merging-a-pr` skill: `feat/access-control-email-infra` (Task 2 is done, so this PR is Task 1 only: the send permission, `ACCESS_FROM_EMAIL` and the suppression list; `Refs #300`) from `dev` after part 2 merged, then `feat/access-control-email` (Tasks 3–5; `Closes #300`) from `dev` after the first merged and CI's apply on `dev` finished. Same reason as parts 1 and 2: the code that reads `ACCESS_FROM_EMAIL` ships after the apply that creates it.
- Site mail `From:` is `Access <access@ashutosh-pandey.com>`, `Reply-To` the same, so replies land in the owner's Zoho inbox.
- Zoho owns the apex MX and SPF (#403). Don't add an apex MX or a second `v=spf1` record. SES sends with MAIL FROM `mail.ashutosh-pandey.com` and needs no apex SPF entry.

## Review Focus

1. **SES rejects a send**, e.g. an address on the account's suppression list after a bounce. The change is saved and the response carries `emailError` naming the SES error, which the page shows. Test in Task 3.
2. **An invitee with no email attribute.** No send is attempted; `emailError` says the address is missing. Test in Task 3.

---

### Task 1: Terraform — sending permission

**Files:**
- Modify: `infra/prod/account/email.tf` (suppression list), `infra/prod/account/access.tf` (send permission and env var)

**Interfaces:**
- Consumes: `aws_sesv2_email_identity.domain`, `aws_iam_role_policy.vercel_access`, `vercel_project.looper`.
- Produces: Vercel env var `ACCESS_FROM_EMAIL` for production; production's Vercel role may `ses:SendEmail` as `access@`.

- [ ] **Step 1: Suppression list**

Append to `infra/prod/account/email.tf`:

```hcl
# Production senders are expected to stop mailing addresses that bounce or complain.
resource "aws_sesv2_account_suppression_attributes" "site" {
  suppressed_reasons = ["BOUNCE", "COMPLAINT"]
}
```

Leave `email.tf`'s header comment as it is: #403 wrote it to cover both senders.

- [ ] **Step 2: Let the app send as `access@`**

In `infra/prod/account/access.tf`, add:

```hcl
locals {
  access_address = "access@${vercel_project_domain.custom.domain}"
}
```

and a statement to `aws_iam_role_policy.vercel_access`, production's Vercel role:

```hcl
      {
        Sid      = "SendAccessEmail"
        Effect   = "Allow"
        Action   = ["ses:SendEmail"]
        Resource = [aws_sesv2_email_identity.domain.arn]
        Condition = {
          StringEquals = { "ses:FromAddress" = local.access_address }
        }
      },
```

and append:

```hcl
resource "vercel_project_environment_variable" "access_from_email" {
  project_id = vercel_project.looper.id
  key        = "ACCESS_FROM_EMAIL"
  value      = local.access_address
  target     = ["production"]
  sensitive  = false
}
```

The preview roles are `aws_iam_role.vercel_preview` in each nonprod account (`infra/modules/nonprod-account/oidc-roles.tf`, #397), and the preview env vars are set in `infra/modules/nonprod-app/main.tf`. Dev's and stage's accounts are still in the SES sandbox and hold their own SES identities, so decide whether previews send at all before adding a statement there.

- [ ] **Step 3: Format, commit, PR**

```bash
cd /e/Personal/looper/infra/prod/account && terraform fmt && terraform validate
cd /e/Personal/looper
git add infra/prod/account/email.tf infra/prod/account/access.tf
git commit -m "feat(infra): let the site send from access@ (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/access-control-email-infra
gh pr create --base dev --title "feat(infra): let the site send from access@ (#300)" --body "$(cat <<'EOF'
Part 3a of #300 (plan: docs/superpowers/plans/2026-09-29-access-control-email.md, Task 1).

- Account suppression list for bounces and complaints
- Production's Vercel role may ses:SendEmail as access@; ACCESS_FROM_EMAIL for production
- No receiving here: Zoho owns the apex MX and access@ is a Zoho alias (#403)

Refs #300
EOF
)"
```

The `Terraform` workflow posts a plan per stack. `prod/account`: 2 to add (the suppression attributes and the env var), 1 to change (`vercel_access`), 0 to destroy. Every other stack: `No changes`. Stop on any destroy.

- [ ] **Step 4: Merge, wait for the apply, check**

Invoke the `merging-a-pr` skill and merge. Then:

```bash
gh run list --workflow terraform.yml --branch dev --limit 1
gh run watch <id> --exit-status
aws sesv2 get-account --profile personal-ro --region us-east-1 --query 'SuppressionAttributes.SuppressedReasons'
```

Expected: the run succeeds; `["BOUNCE", "COMPLAINT"]`.

---

### Task 2: SES production access

Done 2026-10-01; confirm with `aws sesv2 get-account --profile personal-ro --region us-east-1` → `ProductionAccessEnabled: true`.

---

### Task 3: Access emails

**Files:**
- Create: `web/lib/access-mail.ts`
- Test: `web/lib/access-mail.test.ts`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: `AccessUser` (part 2, `lib/access-admin.ts`); `Grant` (part 2); `METERED_LABELS` (part 2, `lib/authz/my-grants.ts`); `awsCredentials()`.
- Produces: `sendApproved(user: AccessUser): Promise<string | null>`, `sendGrants(user: AccessUser, grants: Grant[]): Promise<string | null>`, `sendEnded(user: AccessUser, what: string): Promise<string | null>` — each returns `null` when sent, or the reason it wasn't.

- [ ] **Step 1: Branch and install**

Start from `dev` after Task 1's PR merged and its apply finished:

```bash
cd /e/Personal/looper && git switch dev && git pull && git switch -c feat/access-control-email
cd web && npm install @aws-sdk/client-sesv2
```

- [ ] **Step 2: Write the failing tests**

`web/lib/access-mail.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { sendApproved, sendEnded, sendGrants } from "./access-mail";

const ses = mockClient(SESv2Client);
const user = { sub: "u1", username: "Google_1", email: "jane@example.com", createdAt: "", groups: ["friends"] };

beforeEach(() => {
  ses.reset();
  process.env.ACCESS_FROM_EMAIL = "access@ashutosh-pandey.com";
  process.env.APP_AWS_REGION = "us-east-1";
});

describe("access emails", () => {
  it("sends the approval from and replying to the access address", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    expect(await sendApproved(user)).toBeNull();
    const input = ses.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.FromEmailAddress).toBe("Access <access@ashutosh-pandey.com>");
    expect(input.ReplyToAddresses).toEqual(["access@ashutosh-pandey.com"]);
    expect(input.Destination).toEqual({ ToAddresses: ["jane@example.com"] });
    expect(input.Content?.Simple?.Subject?.Data).toBe("You can now use the tools on ashutosh-pandey.com");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("BGM Looper, Money Planner and News Desk");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("https://ashutosh-pandey.com/tools");
  });

  it("lists every live grant, with uses left and the last day", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendGrants(user, [
      { sub: "u1", action: "newsdesk:ask", email: "", limit: 20, used: 0, expiresAt: 1_791_504_000, grantedAt: 0 },
      { sub: "u1", action: "looper:process", email: "", limit: 5, used: 2, expiresAt: 1_791_504_000, grantedAt: 0 },
    ]);
    const text = ses.commandCalls(SendEmailCommand)[0].args[0].input.Content?.Simple?.Body?.Text?.Data;
    expect(text).toContain("News Desk ask: 20 uses, until 9 Oct 2026");
    expect(text).toContain("BGM Looper processing: 3 uses, until 9 Oct 2026");
  });

  it("says what ended", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendEnded(user, "News Desk ask");
    expect(ses.commandCalls(SendEmailCommand)[0].args[0].input.Content?.Simple?.Body?.Text?.Data).toContain(
      "Your access to News Desk ask on ashutosh-pandey.com has ended.",
    );
  });

  it("returns SES's error instead of throwing, e.g. in the sandbox", async () => {
    ses.on(SendEmailCommand).rejects(Object.assign(new Error("Email address is not verified."), { name: "MessageRejected" }));
    expect(await sendApproved(user)).toBe("MessageRejected: Email address is not verified.");
  });

  it("sends nothing to a user without an email address", async () => {
    expect(await sendApproved({ ...user, email: "" })).toBe("this account has no email address");
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it("sends nothing when ACCESS_FROM_EMAIL is not set", async () => {
    delete process.env.ACCESS_FROM_EMAIL;
    expect(await sendApproved(user)).toBe("ACCESS_FROM_EMAIL is not set");
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd web && npx vitest run lib/access-mail.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`web/lib/access-mail.ts`:

```ts
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { awsCredentials } from "./aws";
import type { AccessUser } from "./access-admin";
import type { Grant } from "./authz/grants";
import { METERED_LABELS } from "./authz/my-grants";

const SITE = "https://ashutosh-pandey.com";

let client: SESv2Client | null = null;
const ses = () => (client ??= new SESv2Client({ region: process.env.APP_AWS_REGION!, ...awsCredentials() }));

const day = (s: number) =>
  new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Null when sent; otherwise why not. A failed email never undoes the change
 * that triggered it: the Access page shows the reason instead. */
async function send(to: string, subject: string, lines: string[]): Promise<string | null> {
  const from = process.env.ACCESS_FROM_EMAIL;
  if (!from) return "ACCESS_FROM_EMAIL is not set";
  if (!to) return "this account has no email address";
  const text = [...lines, "", "Reply to this email if you have a question."].join("\n");
  const html = text
    .split("\n\n")
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  try {
    await ses().send(
      new SendEmailCommand({
        FromEmailAddress: `Access <${from}>`,
        ReplyToAddresses: [from],
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: { Text: { Data: text }, Html: { Data: html } },
          },
        },
      }),
    );
    return null;
  } catch (err) {
    const e = err as Error;
    console.error("access: email failed", e);
    return `${e.name}: ${e.message}`;
  }
}

export function sendApproved(user: AccessUser): Promise<string | null> {
  return send(user.email, "You can now use the tools on ashutosh-pandey.com", [
    "You've been given access to BGM Looper, Money Planner and News Desk.",
    "",
    `Sign in at ${SITE}/tools with the same Google account.`,
    "",
    "Anything that costs money to run (the News Desk assistant and refresh, BGM Looper processing) needs a separate grant. Reply to ask for one.",
  ]);
}

export function sendGrants(user: AccessUser, grants: Grant[]): Promise<string | null> {
  const lines = grants.map((g) => `${METERED_LABELS[g.action]}: ${g.limit - g.used} uses, until ${day(g.expiresAt)}`);
  return send(user.email, "Your grants on ashutosh-pandey.com", [
    "You can now use:",
    "",
    ...lines,
    "",
    `Your remaining uses are shown at ${SITE}/tools.`,
  ]);
}

export function sendEnded(user: AccessUser, what: string): Promise<string | null> {
  return send(user.email, "Your access on ashutosh-pandey.com has ended", [
    `Your access to ${what} on ashutosh-pandey.com has ended.`,
  ]);
}
```

- [ ] **Step 5: Run and commit**

Run: `cd web && npx vitest run lib/access-mail.test.ts`
Expected: PASS.

```bash
git add web/lib/access-mail.ts web/lib/access-mail.test.ts web/package.json web/package-lock.json
git commit -m "feat(access): approval, grant and access-ended emails (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 4: The Access routes send the emails

**Files:**
- Modify: `web/app/api/access/members/route.ts`, `web/app/api/access/members/[sub]/route.ts`, `web/app/api/access/grants/route.ts`, `web/app/api/access/grants/[sub]/[action]/route.ts`
- Test: `web/app/api/access/routes.test.ts`

**Interfaces:**
- Consumes: Task 3's senders; `getGrantStore` (part 2).
- Produces: change responses `{ ok: true }` or `{ ok: true, emailError: string }`. The page (part 2, `AccessAdmin.tsx`) already shows `emailError`. Dismiss sends nothing.

- [ ] **Step 1: Write the failing tests**

In `web/app/api/access/routes.test.ts`, add mocks:

```ts
vi.mock("@/lib/access-mail", () => ({ sendApproved: vi.fn(), sendGrants: vi.fn(), sendEnded: vi.fn() }));
vi.mock("@/lib/authz/grants", () => ({ getGrantStore: vi.fn() }));
import { sendApproved, sendEnded, sendGrants } from "@/lib/access-mail";
import { getGrantStore } from "@/lib/authz/grants";
```

In `beforeEach`: `vi.mocked(sendApproved).mockResolvedValue(null); vi.mocked(sendGrants).mockResolvedValue(null); vi.mocked(sendEnded).mockResolvedValue(null); vi.mocked(getGrantStore).mockReturnValue({ list: vi.fn(async () => []) } as never);`

Add:

```ts
describe("/api/access emails", () => {
  it("approve emails the new member", async () => {
    vi.mocked(approve).mockResolvedValue(user);
    expect(await (await approveRoute(json({ sub: "u1" }))).json()).toEqual({ ok: true });
    expect(sendApproved).toHaveBeenCalledWith(user);
  });

  it("reports a failed email without failing the change", async () => {
    vi.mocked(approve).mockResolvedValue(user);
    vi.mocked(sendApproved).mockResolvedValue("MessageRejected: Email address is not verified.");
    const res = await approveRoute(json({ sub: "u1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailError: "MessageRejected: Email address is not verified." });
  });

  it("grant emails every live grant the member now holds", async () => {
    const live = { action: "newsdesk:ask", limit: 20, used: 0, expiresAt: 9e9 };
    const spent = { action: "looper:process", limit: 5, used: 5, expiresAt: 9e9 };
    vi.mocked(grantAction).mockResolvedValue({ user, grant: live as never });
    vi.mocked(getGrantStore).mockReturnValue({ list: vi.fn(async () => [live, spent]) } as never);
    await grantRoute(json({ sub: "u1", action: "newsdesk:ask" }));
    expect(sendGrants).toHaveBeenCalledWith(user, [live]);
  });

  it("remove and revoke email what ended; dismiss sends nothing", async () => {
    vi.mocked(removeMember).mockResolvedValue(user);
    vi.mocked(revokeGrant).mockResolvedValue(user);
    vi.mocked(dismiss).mockResolvedValue(user);
    await removeRoute(new Request("http://x"), params({ sub: "u1" }));
    await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "newsdesk:ask" }));
    await dismissRoute(new Request("http://x"), params({ sub: "u1" }));
    expect(sendEnded).toHaveBeenNthCalledWith(1, user, "the tools");
    expect(sendEnded).toHaveBeenNthCalledWith(2, user, "News Desk ask");
    expect(sendEnded).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd web && npx vitest run app/api/access`
Expected: the new block FAILS (nothing sent).

- [ ] **Step 3: Implement**

Add to `web/lib/access-api.ts`:

```ts
/** The change succeeded; say so, and pass on why the email didn't go, if it didn't. */
export function changed(emailError: string | null): Response {
  return NextResponse.json(emailError ? { ok: true, emailError } : { ok: true });
}
```

`web/app/api/access/members/route.ts` — in the `respond` callback, replace `return NextResponse.json({ ok: true });` with `return changed(await sendApproved(user));`, import `sendApproved` from `@/lib/access-mail` and `changed` from `@/lib/access-api`, and drop the unused `NextResponse` import.

`web/app/api/access/members/[sub]/route.ts` — replace the return with `return changed(await sendEnded(user, "the tools"));`, same import changes with `sendEnded`.

`web/app/api/access/grants/route.ts` — replace the return with:

```ts
    const now = Math.floor(Date.now() / 1000);
    const live = (await getGrantStore().list(user.sub)).filter((g) => g.used < g.limit && g.expiresAt > now);
    return changed(await sendGrants(user, live));
```

importing `getGrantStore` from `@/lib/authz/grants` and `sendGrants` from `@/lib/access-mail`. (Reading the list after the put includes the new grant.)

`web/app/api/access/grants/[sub]/[action]/route.ts` — replace the return with `return changed(await sendEnded(user, METERED_LABELS[parsed.data]));`, importing `METERED_LABELS` from `@/lib/authz/my-grants` and `sendEnded`.

Leave `pending/[sub]/route.ts` as it is.

- [ ] **Step 4: Run and commit**

Run: `cd web && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS.

```bash
git add web/lib/access-api.ts web/app/api/access
git commit -m "feat(access): email invitees when their access changes (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 5: Docs, CHANGELOG, PR, final checks

**Files:**
- Modify: `.claude/rules/infra.md`, `ARCHITECTURE.md`, `CHANGELOG.md`

- [ ] **Step 1: Docs**

- `.claude/rules/infra.md`: no new bullet. The apex mail records bullet (#403) already says the apex SPF includes Zoho and that a new service sending as the bare domain goes into `apex_spf`'s include list. Access emails go through SES with MAIL FROM `mail.`, so they need no change there.
- `ARCHITECTURE.md`: add to the cost/services section: "SESv2 sending for access emails: about $0.10 per 1,000 messages. Mail to `access@` is received by Zoho (#403)."

- [ ] **Step 2: CHANGELOG**

Under `[Unreleased]` → `### Added`:

```markdown
- Email for access requests: people get an email from access@ashutosh-pandey.com when they're approved, given a grant, or lose access, and mail to that address lands in the owner's Zoho inbox (#300).
```

- [ ] **Step 3: Verify everything**

```bash
cd /e/Personal/looper/web && npm test && npm run lint && npx tsc --noEmit
KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build && npm run test:e2e
```

Expected: all green.

- [ ] **Step 4: Commit, push, PR**

```bash
cd /e/Personal/looper
git add .claude/rules/infra.md ARCHITECTURE.md CHANGELOG.md
git commit -m "docs: access email (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/access-control-email
gh pr create --base dev --title "feat: access@ email in and out (#300)" --body "$(cat <<'EOF'
Part 3b of #300 (plan: docs/superpowers/plans/2026-09-29-access-control-email.md).

- Uses the send permission applied by the infra PR (Task 1)
- The Access page emails invitees on approve, grant, remove and revoke; a failed send is reported and doesn't undo the change
- SES production access granted 2026-10-01

Closes #300
EOF
)"
```

Then invoke the `merging-a-pr` skill and follow it to merge.

- [ ] **Step 5: Manual check on `dev`**

1. From a second account, email `access@ashutosh-pandey.com` → it lands in the owner's Zoho inbox.
2. Approve the account on the Access page → it receives "You can now use the tools on ashutosh-pandey.com".
3. Grant News Desk ask, 2 uses → it receives "Your grants on ashutosh-pandey.com" listing "News Desk ask: 2 uses, until …".
4. Revoke it → "Your access on ashutosh-pandey.com has ended".
5. Reply to any of these from the second account → the reply lands in the owner's Zoho inbox.
