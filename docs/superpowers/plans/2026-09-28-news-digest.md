# News Desk Daily Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily 07:30 IST News Desk refresh on production that emails the owner the new headlines through SES, triggered by EventBridge Scheduler through an API destination.

**Architecture:** Scheduler puts a `NewsDigestRequested` event on a custom `looper` bus; a per-env rule sends it to an API destination that POSTs `/api/digest/news-desk` with an `x-digest-token` header. The route answers 202 at once and runs the refresh and the SES send in `after()`. SES sends from a DKIM-verified `ashutosh-pandey.com` identity whose DNS records Terraform writes into Vercel DNS.

**Tech Stack:** Terraform `aws` ~> 6.62 and `vercel` ~> 5.15; Next.js 16 route handlers with `after` from `next/server`; `@aws-sdk/client-sesv2`; Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-news-digest-design.md`. Issue #289, epic #285.

**Independent of phases 1–3.** Phase 5 needs Task 1's `aws_sesv2_email_identity.domain`.

## Global Constraints

- Route: `POST /api/digest/news-desk`; header `x-digest-token`; env vars `DIGEST_TOKEN`, `DIGEST_FROM`, `DIGEST_TO`, plus the existing `S3_BUCKET_NAME`; `maxDuration = 60`; answers `202 {"accepted": true}`.
- Sender `News Desk <digest@ashutosh-pandey.com>`; recipient `var.alert_email`.
- Event: bus `looper`, `source = "looper.scheduler"`, `detail-type = "NewsDigestRequested"`, `detail = {"env": "<main|dev|stage>"}`.
- Schedule: `cron(30 7 * * ? *)`, `Asia/Kolkata`, flexible window `OFF`, created `DISABLED`, enabled in Task 6.
- Section order: Economy, Reforms, Legislation, Untagged. `Drop` never appears.
- Every manual `aws` CLI call: `--profile personal --region us-east-1`.
- Terraform: plan against real state, apply with the owner's go-ahead before merge, then `No changes.`.
- New required Terraform variables: none. `CLAUDE.md`'s "five required variables" stays true.
- Commits end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.

## Review Focus

- **The previous snapshot is corrupt** (`SnapshotCorruptError`): `runRefresh` already recovers from it; the digest must not throw before calling it. Test in Task 3.
- **A headline title with `<`, `&` or quotes**: the HTML body must escape it. Test in Task 3.
- **A request without the token, or with a token of a different length**: 401 without a timing difference and without throwing on the length mismatch. Test in Task 4.
- **The refresh throws inside `after()`** (S3 down, OpenRouter down): the route has already answered 202, so the error must be logged, not unhandled. Test in Task 4.
- **The schedule firing before production has the route**: prevented by creating it `DISABLED` (Task 5) and enabling it only after promotion (Task 6).

---

Tasks 1–5 are one PR on `feat/news-digest`: `git switch dev && git pull && git switch -c feat/news-digest`. Task 6 is a follow-up PR.

### Task 1: SES identities and DNS

**Files:**
- Create: `infra/main/email.tf`
- Modify: `infra/main/shared.tf` (`aws_iam_role_policy.vercel`)

**Interfaces:**
- Produces: `aws_sesv2_email_identity.domain` (phase 5 uses its ARN for Cognito's email configuration), `aws_sesv2_email_identity.owner`.

- [ ] **Step 1: Write `infra/main/email.tf`**

```hcl
# SES for mail sent from ashutosh-pandey.com: the News Desk digest (spec
# 2026-09-28-news-digest-design.md) and, later, Cognito sign-in codes. The account
# stays in the SES sandbox: the only recipient is the owner, a verified identity.

resource "aws_sesv2_email_identity" "domain" {
  email_identity = vercel_project_domain.custom.domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# Easy DKIM: three CNAMEs. count, not for_each, because the tokens are unknown
# until the identity exists.
resource "vercel_dns_record" "ses_dkim" {
  count  = 3
  domain = vercel_project_domain.custom.domain
  name   = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}._domainkey"
  type   = "CNAME"
  value  = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"
  ttl    = 1800
}

# p=none: report nothing, reject nothing, but DMARC-aware receivers see a policy.
# No rua= address, which would publish the owner's email in DNS.
resource "vercel_dns_record" "dmarc" {
  domain = vercel_project_domain.custom.domain
  name   = "_dmarc"
  type   = "TXT"
  value  = "v=DMARC1; p=none;"
  ttl    = 1800
}

# In the sandbox SES delivers only to verified addresses. SES emails a link to this
# address on first apply; it must be clicked once.
resource "aws_sesv2_email_identity" "owner" {
  email_identity = var.alert_email
}
```

- [ ] **Step 2: Let Vercel send.** In `aws_iam_role_policy.vercel`, add a statement:

```hcl
      {
        Sid      = "SendDigest"
        Effect   = "Allow"
        Action   = ["ses:SendEmail"]
        Resource = [aws_sesv2_email_identity.domain.arn, aws_sesv2_email_identity.owner.arn]
      },
```

- [ ] **Step 3: Plan, apply, verify**

Run: `cd infra/main && terraform fmt && terraform validate && terraform plan -var-file=terraform.tfvars`
Expected: 2 identities, 4 DNS records created; `vercel` policy updated in place. Nothing else.

This task has no web code and is safe to apply on its own. With the owner's go-ahead, `terraform apply -var-file=terraform.tfvars`. Then:
1. The owner clicks the SES verification link sent to their address.
2. Within about an hour: `aws sesv2 get-email-identity --email-identity ashutosh-pandey.com --query "{verified: VerifiedForSendingStatus, dkim: DkimAttributes.Status}" --profile personal --region us-east-1` shows `verified: true, dkim: SUCCESS`.
3. `aws sesv2 send-email --from-email-address "digest@ashutosh-pandey.com" --destination "ToAddresses=<owner email>" --content "Simple={Subject={Data=SES test},Body={Text={Data=hello}}}" --profile personal --region us-east-1` delivers; Gmail's "Show original" shows `DKIM: PASS` and `DMARC: PASS`.

- [ ] **Step 4: Commit**

```bash
git add infra/main/email.tf infra/main/shared.tf
git commit -m "feat(infra): SES identity for ashutosh-pandey.com with DKIM and DMARC

Refs #289

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 2: `sendEmail`

**Files:**
- Modify: `web/package.json`, `web/package-lock.json` (add `@aws-sdk/client-sesv2`)
- Modify: `web/lib/aws.ts` (add `getSesClient`)
- Create: `web/lib/email.ts`
- Test: `web/lib/email.test.ts`

**Interfaces:**
- Produces: `getSesClient(): SESv2Client`; `type Email = { from: string; to: string; subject: string; text: string; html: string }`; `sendEmail(email: Email): Promise<void>`.

- [ ] **Step 1: Install** — `cd web && npm install @aws-sdk/client-sesv2`

- [ ] **Step 2: Failing test** `web/lib/email.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { sendEmail } from "./email";

const send = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/aws", () => ({ getSesClient: () => ({ send }) }));

describe("sendEmail", () => {
  it("sends a simple two-part message", async () => {
    await sendEmail({
      from: "News Desk <digest@example.com>",
      to: "owner@example.com",
      subject: "Hi",
      text: "plain",
      html: "<p>rich</p>",
    });
    expect(send.mock.calls[0][0].input).toEqual({
      FromEmailAddress: "News Desk <digest@example.com>",
      Destination: { ToAddresses: ["owner@example.com"] },
      Content: {
        Simple: {
          Subject: { Data: "Hi", Charset: "UTF-8" },
          Body: {
            Text: { Data: "plain", Charset: "UTF-8" },
            Html: { Data: "<p>rich</p>", Charset: "UTF-8" },
          },
        },
      },
    });
  });
});
```

Run: `cd web && npx vitest run lib/email.test.ts` — Expected: FAIL (no `./email`).

- [ ] **Step 3: Implement.** In `web/lib/aws.ts`, import `SESv2Client` from `@aws-sdk/client-sesv2` and add after `getS3Client`:

```ts
export function getSesClient(): SESv2Client {
  return new SESv2Client({ region: process.env.APP_AWS_REGION!, ...awsCredentials() });
}
```

Create `web/lib/email.ts`:

```ts
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { getSesClient } from "@/lib/aws";

export type Email = { from: string; to: string; subject: string; text: string; html: string };

/** One message through SES from a verified identity. The account is in the SES
 * sandbox, so `to` must be a verified address too. */
export async function sendEmail(email: Email): Promise<void> {
  await getSesClient().send(
    new SendEmailCommand({
      FromEmailAddress: email.from,
      Destination: { ToAddresses: [email.to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: email.text, Charset: "UTF-8" },
            Html: { Data: email.html, Charset: "UTF-8" },
          },
        },
      },
    }),
  );
}
```

Run: `cd web && npx vitest run lib/email.test.ts` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json web/lib/aws.ts web/lib/email.ts web/lib/email.test.ts
git commit -m "feat(web): send email through SES

Refs #289

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 3: Digest content and send

**Files:**
- Create: `web/lib/news-desk/digest.ts`
- Test: `web/lib/news-desk/digest.test.ts`

**Interfaces:**
- Consumes: `readSnapshot`, `SnapshotCorruptError` (`./store`); `runRefresh` (`./refresh`); `TOPICS` (`./tags`); `Headline`, `Snapshot` (`./types`); `sendEmail` (`@/lib/email`).
- Produces: `newHeadlines(previous: Snapshot | null, current: Snapshot): Headline[]`; `renderDigest(items: Headline[], siteUrl: string): { subject: string; text: string; html: string }`; `sendNewsDigest(now?: Date): Promise<{ sent: boolean; count: number }>`.

- [ ] **Step 1: Failing tests** `web/lib/news-desk/digest.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Headline, Snapshot } from "./types";

vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  readSnapshot: vi.fn(),
}));
vi.mock("./refresh", () => ({ runRefresh: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { readSnapshot, SnapshotCorruptError } from "./store";
import { runRefresh } from "./refresh";
import { sendEmail } from "@/lib/email";
import { newHeadlines, renderDigest, sendNewsDigest } from "./digest";

function headline(id: string, tag: Headline["tag"], title = `Title ${id}`): Headline {
  return {
    id,
    title,
    url: `https://example.com/${id}`,
    source: "Mint",
    publishedAt: "2026-09-28T01:00:00.000Z",
    direct: true,
    tag,
  };
}

function snapshot(headlines: Headline[]): Snapshot {
  return { version: 1, refreshedAt: "2026-09-28T02:00:00.000Z", headlines, indicators: [], sourceErrors: [] };
}

describe("newHeadlines", () => {
  it("keeps only ids the previous snapshot did not have, and never Drop", () => {
    const previous = snapshot([headline("a", "Economy")]);
    const current = snapshot([headline("a", "Economy"), headline("b", "Reforms"), headline("c", "Drop")]);
    expect(newHeadlines(previous, current).map((h) => h.id)).toEqual(["b"]);
  });

  it("treats everything as new when there is no previous snapshot", () => {
    const current = snapshot([headline("a", "Economy"), headline("b", "Untagged")]);
    expect(newHeadlines(null, current).map((h) => h.id)).toEqual(["a", "b"]);
  });
});

describe("renderDigest", () => {
  const items = [
    headline("u", "Untagged"),
    headline("l", "Legislation"),
    headline("e", "Economy", "RBI holds rate <5.5%> & \"steady\""),
  ];

  it("counts headlines in the subject", () => {
    expect(renderDigest(items, "https://site").subject).toBe("News Desk: 3 new headlines");
    expect(renderDigest([items[0]], "https://site").subject).toBe("News Desk: 1 new headline");
  });

  it("orders sections by topic, then Untagged, and skips empty ones", () => {
    const { text } = renderDigest(items, "https://site");
    const order = ["Economy", "Legislation", "Untagged"].map((t) => text.indexOf(`${t}\n`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(text).not.toContain("Reforms\n");
    expect(text).toContain("https://site/tools/news-desk");
  });

  it("escapes titles in the HTML body", () => {
    const { html } = renderDigest(items, "https://site");
    expect(html).toContain("RBI holds rate &lt;5.5%&gt; &amp; &quot;steady&quot;");
    expect(html).not.toContain("<5.5%>");
  });
});

describe("sendNewsDigest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIGEST_FROM = "News Desk <digest@example.com>";
    process.env.DIGEST_TO = "owner@example.com";
  });

  it("refreshes and emails the new headlines", async () => {
    vi.mocked(readSnapshot).mockResolvedValue(snapshot([headline("a", "Economy")]));
    vi.mocked(runRefresh).mockResolvedValue(snapshot([headline("a", "Economy"), headline("b", "Economy")]));

    expect(await sendNewsDigest()).toEqual({ sent: true, count: 1 });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toMatchObject({
      from: "News Desk <digest@example.com>",
      to: "owner@example.com",
      subject: "News Desk: 1 new headline",
    });
  });

  it("sends nothing when nothing is new", async () => {
    const same = snapshot([headline("a", "Economy")]);
    vi.mocked(readSnapshot).mockResolvedValue(same);
    vi.mocked(runRefresh).mockResolvedValue(same);

    expect(await sendNewsDigest()).toEqual({ sent: false, count: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still refreshes when the previous snapshot is corrupt", async () => {
    vi.mocked(readSnapshot).mockRejectedValue(new SnapshotCorruptError("bad"));
    vi.mocked(runRefresh).mockResolvedValue(snapshot([headline("a", "Economy")]));

    expect(await sendNewsDigest()).toEqual({ sent: true, count: 1 });
  });
});
```

Run: `cd web && npx vitest run lib/news-desk/digest.test.ts` — Expected: FAIL (no `./digest`).

- [ ] **Step 2: Implement** `web/lib/news-desk/digest.ts`:

```ts
import { sendEmail } from "@/lib/email";
import { runRefresh } from "./refresh";
import { readSnapshot, SnapshotCorruptError } from "./store";
import { TOPICS } from "./tags";
import type { Headline, Snapshot } from "./types";

const SECTIONS = [...TOPICS, "Untagged"] as const;

/** Headlines the current snapshot has and the previous did not, minus the ones
 * the tagger dropped as off-topic. */
export function newHeadlines(previous: Snapshot | null, current: Snapshot): Headline[] {
  const seen = new Set((previous?.headlines ?? []).map((h) => h.id));
  return current.headlines.filter((h) => !seen.has(h.id) && h.tag !== "Drop");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderDigest(
  items: Headline[],
  siteUrl: string,
): { subject: string; text: string; html: string } {
  const sections = SECTIONS.map((tag) => ({ tag, items: items.filter((h) => h.tag === tag) })).filter(
    (s) => s.items.length > 0,
  );
  const deskUrl = `${siteUrl}/tools/news-desk`;

  const text = [
    ...sections.flatMap((s) => [
      s.tag,
      ...s.items.map((h) => `- ${h.title} — ${h.source}\n  ${h.url}`),
      "",
    ]),
    `Open the News Desk: ${deskUrl}`,
  ].join("\n");

  const html = [
    ...sections.map(
      (s) =>
        `<h2>${s.tag}</h2><ul>${s.items
          .map((h) => `<li><a href="${escapeHtml(h.url)}">${escapeHtml(h.title)}</a> — ${escapeHtml(h.source)}</li>`)
          .join("")}</ul>`,
    ),
    `<p><a href="${deskUrl}">Open the News Desk</a></p>`,
  ].join("");

  const n = items.length;
  return { subject: `News Desk: ${n} new headline${n === 1 ? "" : "s"}`, text, html };
}

/** The scheduled job: refresh, then email what is new. Nothing new sends nothing. */
export async function sendNewsDigest(now: Date = new Date()): Promise<{ sent: boolean; count: number }> {
  let previous: Snapshot | null;
  try {
    previous = await readSnapshot();
  } catch (err) {
    // runRefresh recovers from a corrupt snapshot by starting over; the digest
    // follows it and treats every headline as new.
    if (!(err instanceof SnapshotCorruptError)) throw err;
    previous = null;
  }

  const current = await runRefresh(now);
  const items = newHeadlines(previous, current);
  if (items.length === 0) return { sent: false, count: 0 };

  await sendEmail({
    from: process.env.DIGEST_FROM!,
    to: process.env.DIGEST_TO!,
    ...renderDigest(items, "https://ashutosh-pandey.com"),
  });
  return { sent: true, count: items.length };
}
```

`readPrevious` in `refresh.ts` catches `SnapshotCorruptError` and returns `null` (verified 2026-09-28), which is what the comment above relies on.

Run: `cd web && npx vitest run lib/news-desk/digest.test.ts` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/lib/news-desk/digest.ts web/lib/news-desk/digest.test.ts
git commit -m "feat(web): build and send the News Desk digest

Refs #289

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 4: `POST /api/digest/news-desk`

**Files:**
- Create: `web/app/api/digest/news-desk/route.ts`
- Test: `web/app/api/digest/news-desk/route.test.ts`

**Interfaces:**
- Consumes: `sendNewsDigest` (Task 3); `after` from `next/server`.
- Produces: the endpoint the API destinations call (Task 5).

Read `web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` first: `after` runs within the route's `maxDuration` and runs even if the response errored.

- [ ] **Step 1: Failing tests** `web/app/api/digest/news-desk/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduled = vi.hoisted(() => [] as Array<() => Promise<void>>);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (cb: () => Promise<void>) => scheduled.push(cb),
}));
vi.mock("@/lib/news-desk/digest", () => ({ sendNewsDigest: vi.fn() }));

import { sendNewsDigest } from "@/lib/news-desk/digest";
import { maxDuration, POST } from "./route";

function call(token?: string) {
  return POST(
    new Request("http://localhost/api/digest/news-desk", {
      method: "POST",
      headers: token === undefined ? {} : { "x-digest-token": token },
    }),
  );
}

describe("POST /api/digest/news-desk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduled.length = 0;
    process.env.DIGEST_TOKEN = "s3cret-token";
    process.env.DIGEST_FROM = "a@b";
    process.env.DIGEST_TO = "c@d";
    process.env.S3_BUCKET_NAME = "bucket";
  });

  it("allows a full refresh after answering", () => {
    expect(maxDuration).toBe(60);
  });

  it("answers 503 when the digest is not configured", async () => {
    delete process.env.DIGEST_TOKEN;
    expect((await call("s3cret-token")).status).toBe(503);
    expect(scheduled).toHaveLength(0);
  });

  it.each([undefined, "", "wrong-token!", "s3cret-token-but-longer"])(
    "refuses token %s",
    async (token) => {
      expect((await call(token)).status).toBe(401);
      expect(scheduled).toHaveLength(0);
    },
  );

  it("accepts at once and runs the digest after the response", async () => {
    vi.mocked(sendNewsDigest).mockResolvedValue({ sent: true, count: 2 });
    const res = await call("s3cret-token");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
    expect(sendNewsDigest).not.toHaveBeenCalled();

    await scheduled[0]();
    expect(sendNewsDigest).toHaveBeenCalledOnce();
  });

  it("logs a failed digest instead of throwing after the response", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendNewsDigest).mockRejectedValue(new Error("S3 down"));
    await call("s3cret-token");

    await expect(scheduled[0]()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("news-desk: digest failed", expect.any(Error));
  });
});
```

Run: `cd web && npx vitest run app/api/digest` — Expected: FAIL (no `./route`).

- [ ] **Step 2: Implement** `web/app/api/digest/news-desk/route.ts`:

```ts
import { createHash, timingSafeEqual } from "crypto";
import { after, NextResponse } from "next/server";
import { sendNewsDigest } from "@/lib/news-desk/digest";

// The response goes out at once (EventBridge API destinations give up after 5 s);
// this bounds the refresh-and-send that after() runs.
export const maxDuration = 60;

function isConfigured(): boolean {
  return ["DIGEST_TOKEN", "DIGEST_FROM", "DIGEST_TO", "S3_BUCKET_NAME"].every(
    (name) => Boolean(process.env[name]),
  );
}

// Both sides hashed to 32 bytes first, so neither the comparison nor a length
// check can leak the token's length through timing.
function tokenMatches(submitted: string, actual: string): boolean {
  const a = createHash("sha256").update(submitted).digest();
  const b = createHash("sha256").update(actual).digest();
  return timingSafeEqual(a, b);
}

// Outside the gated /api/news-desk/* prefix on purpose: the caller is EventBridge,
// which has no session cookie. The token is the gate.
export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "digest not configured" }, { status: 503 });
  }
  if (!tokenMatches(request.headers.get("x-digest-token") ?? "", process.env.DIGEST_TOKEN!)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  after(async () => {
    try {
      console.info("news-desk: digest", await sendNewsDigest());
    } catch (err) {
      console.error("news-desk: digest failed", err);
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
```

Run: `cd web && npm test && npm run lint` — Expected: PASS. Also confirm `/api/digest` is not matched by `isGatedPath` in `web/lib/route-gate.ts` (it gates `/api/news-desk/*`, not `/api/digest/*`); add a case to `web/lib/route-gate.test.ts` asserting `isGatedPath("/api/digest/news-desk") === false`, so a later widening of the gate breaks a test rather than the schedule.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/digest web/lib/route-gate.test.ts
git commit -m "feat(web): token-gated digest endpoint for EventBridge

Refs #289

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 5: Bus, API destinations, rules, schedule; PR

**Files:**
- Modify: `infra/main/email.tf` (append the EventBridge section)
- Modify: `infra/main/shared.tf` (token, Vercel env vars)
- Modify: `CHANGELOG.md`, `ARCHITECTURE.md`

- [ ] **Step 1: Token and env vars.** In `infra/main/shared.tf`, after `random_password.cookie_secret`:

```hcl
# Shared secret between the EventBridge connection and the digest route.
resource "random_password" "digest_token" {
  length  = 40
  special = false
}
```

After `vercel_project_environment_variable.cookie_secret`:

```hcl
resource "vercel_project_environment_variable" "digest_token" {
  project_id = vercel_project.looper.id
  key        = "DIGEST_TOKEN"
  value      = random_password.digest_token.result
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "digest_from" {
  project_id = vercel_project.looper.id
  key        = "DIGEST_FROM"
  value      = "News Desk <digest@${aws_sesv2_email_identity.domain.email_identity}>"
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "digest_to" {
  project_id = vercel_project.looper.id
  key        = "DIGEST_TO"
  value      = aws_sesv2_email_identity.owner.email_identity
  target     = local.env_targets
  sensitive  = true
}
```

- [ ] **Step 2: EventBridge.** Append to `infra/main/email.tf`:

```hcl
# --- Scheduled digest: Scheduler -> looper bus -> rule -> API destination -> Vercel ---

locals {
  site_hosts = {
    main  = vercel_project_domain.custom.domain
    dev   = "dev.${vercel_project_domain.custom.domain}"
    stage = "stage.${vercel_project_domain.custom.domain}"
  }
}

resource "aws_cloudwatch_event_bus" "looper" {
  name = "looper"
}

# EventBridge keeps the key in a Secrets Manager secret it manages; that secret's
# cost is included in the API destination price.
resource "aws_cloudwatch_event_connection" "news_digest" {
  name               = "news-digest"
  authorization_type = "API_KEY"
  auth_parameters {
    api_key {
      key   = "x-digest-token"
      value = random_password.digest_token.result
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "news_digest" {
  for_each                         = local.site_hosts
  name                             = "news-digest-${each.key}"
  invocation_endpoint              = "https://${each.value}/api/digest/news-desk"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.news_digest.arn
}

resource "aws_cloudwatch_event_rule" "news_digest" {
  for_each       = local.site_hosts
  name           = "news-digest-${each.key}"
  event_bus_name = aws_cloudwatch_event_bus.looper.name
  event_pattern = jsonencode({
    source        = ["looper.scheduler"]
    "detail-type" = ["NewsDigestRequested"]
    detail        = { env = [each.key] }
  })
}

resource "aws_iam_role" "news_digest_events" {
  name = "${var.project_name}-news-digest-events"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "events.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "news_digest_events" {
  name = "${var.project_name}-news-digest-events"
  role = aws_iam_role.news_digest_events.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["events:InvokeApiDestination"]
      Resource = [for d in aws_cloudwatch_event_api_destination.news_digest : d.arn]
    }]
  })
}

resource "aws_cloudwatch_event_target" "news_digest" {
  for_each       = aws_cloudwatch_event_rule.news_digest
  rule           = each.value.name
  event_bus_name = aws_cloudwatch_event_bus.looper.name
  arn            = aws_cloudwatch_event_api_destination.news_digest[each.key].arn
  role_arn       = aws_iam_role.news_digest_events.arn
  input          = "{}"

  # The route answers 202 in well under 5 s; a retry means Vercel was down or
  # answered 5xx/401. Two tries within the hour, then give up until tomorrow.
  retry_policy {
    maximum_retry_attempts       = 2
    maximum_event_age_in_seconds = 3600
  }
}

resource "aws_iam_role" "news_digest_scheduler" {
  name = "${var.project_name}-news-digest-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "scheduler.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "news_digest_scheduler" {
  name = "${var.project_name}-news-digest-scheduler"
  role = aws_iam_role.news_digest_scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["events:PutEvents"]
      Resource = aws_cloudwatch_event_bus.looper.arn
    }]
  })
}

# Production only. Created DISABLED so it cannot fire before the route reaches
# main; enabled by its own PR after the promotion (plan Task 6).
resource "aws_scheduler_schedule" "news_digest" {
  name                         = "news-digest-main"
  schedule_expression          = "cron(30 7 * * ? *)"
  schedule_expression_timezone = "Asia/Kolkata"
  state                        = "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_cloudwatch_event_bus.looper.arn
    role_arn = aws_iam_role.news_digest_scheduler.arn
    input    = jsonencode({ env = "main" })

    eventbridge_parameters {
      source      = "looper.scheduler"
      detail_type = "NewsDigestRequested"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "news_digest_failed" {
  alarm_name          = "news-digest-main-failed-invocations"
  namespace           = "AWS/Events"
  metric_name         = "FailedInvocations"
  dimensions          = { EventBusName = aws_cloudwatch_event_bus.looper.name, RuleName = aws_cloudwatch_event_rule.news_digest["main"].name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]

  alarm_description = "EventBridge could not deliver today's News Desk digest request to production after retries."
}
```

- [ ] **Step 3: Plan**

Run: `cd infra/main && terraform fmt && terraform validate && terraform plan -var-file=terraform.tfvars`
Expected creates: 1 password, 3 Vercel env vars, 1 bus, 1 connection, 3 API destinations, 3 rules, 3 targets, 2 roles + 2 policies, 1 schedule (`state = "DISABLED"`), 1 alarm. No destroys. If `FailedInvocations` for a custom bus needs only the `RuleName` dimension in this account, the alarm will sit in `INSUFFICIENT_DATA`; check it in the console after the dev test (Step 6) and drop `EventBusName` from the dimensions if so.

- [ ] **Step 4: Docs.** `CHANGELOG.md` under `### Added`:

```markdown
- News Desk daily digest: at 07:30 IST production refreshes the News Desk and emails the owner the new headlines, grouped by topic, from digest@ashutosh-pandey.com. EventBridge Scheduler triggers it through an EventBridge API destination; SES sends it (#289).
```

`ARCHITECTURE.md`: add a line under the AWS resources section listing the `looper` event bus, the `news-digest-*` API destinations and rules, the `news-digest-main` schedule and the SES identity.

- [ ] **Step 5: Commit, PR, apply**

```bash
git add infra/main CHANGELOG.md ARCHITECTURE.md
git commit -m "feat(infra): schedule the News Desk digest through EventBridge

Refs #289

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/news-digest
gh pr create --base dev --title "feat: scheduled News Desk digest (Scheduler, API destinations, SES)" --body "Phase 4 (spec 2026-09-28-news-digest-design.md). The schedule is created DISABLED; a follow-up PR enables it after this reaches main. Paste the terraform plan summary here.

Refs #289"
```

With the owner's go-ahead: apply, then `No changes.`. Merge per `merging-a-pr`.

- [ ] **Step 6: Test on dev** once Vercel has deployed `dev` with the new env vars (env var changes only reach new deployments; redeploy dev if the merge's deployment started before the apply):

```bash
aws events put-events --entries '[{"EventBusName":"looper","Source":"looper.scheduler","DetailType":"NewsDigestRequested","Detail":"{\"env\":\"dev\"}"}]' --profile personal --region us-east-1
```

Expected: `FailedEntryCount: 0`; within a minute the digest email arrives (or, if nothing is new, the Vercel runtime log for `/api/digest/news-desk` shows `news-desk: digest { sent: false, count: 0 }`). CloudWatch → `AWS/Events` → `Invocations` for `news-digest-dev` is 1 and `FailedInvocations` 0. Also confirm a request with a bad token gets 401: `curl -s -o /dev/null -w "%{http_code}" -X POST -H "x-digest-token: nope" https://dev.ashutosh-pandey.com/api/digest/news-desk`.

### Task 6: Enable the schedule after promotion

**Files:**
- Modify: `infra/main/email.tf`

No CHANGELOG entry: the Task 5 entry covers it. Branch `chore/enable-news-digest` from `dev`.

- [ ] **Step 1: Confirm the route is live on production:** `curl -s -o /dev/null -w "%{http_code}" -X POST -H "x-digest-token: nope" https://ashutosh-pandey.com/api/digest/news-desk` returns `401` (not `404`).

- [ ] **Step 2: Enable.** In `aws_scheduler_schedule.news_digest`, set `state = "ENABLED"` and change its comment to "Production only. Dev and stage are triggered by hand with aws events put-events.".

Run: `terraform plan -var-file=terraform.tfvars` — Expected: one in-place update to the schedule.

- [ ] **Step 3: Commit, PR, apply, merge**

```bash
git add infra/main/email.tf
git commit -m "chore(infra): enable the daily News Desk digest

Closes #289

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin chore/enable-news-digest
gh pr create --base dev --title "chore(infra): enable the daily News Desk digest" --body "Phase 4 follow-up: the digest route is on production (401 without a token), so the schedule can run.

Closes #289"
```

Apply with the owner's go-ahead before merging. The next morning, confirm the email arrived at 07:30 IST and `FailedInvocations` for `news-digest-main` is 0.
