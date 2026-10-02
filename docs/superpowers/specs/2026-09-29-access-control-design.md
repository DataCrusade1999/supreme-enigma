# Fine-grained tool access — Design

**Date:** 2026-09-29
**Status:** Draft, awaiting the owner's review. Brainstormed with the owner on 2026-09-29; §3 records the decisions made there.
**Issue:** #300
**Epic:** #285 (phase 6 of 6). Builds on phase 5 (#290, the Cognito login).

## 1. Problem

Only the owner can sign in. The callback in `app/api/auth/callback/route.ts` compares the ID token's `email` with `OWNER_EMAIL` and refuses everyone else, and the session cookie that follows records no identity at all: `lib/auth.ts` signs only an issue time. Access is all or nothing.

The owner wants to let other people try some of the tools. Anything that spends money has to stay behind a separate, deliberate grant: the News Desk assistant and refresh call OpenRouter (`lib/news-desk/ask.ts`, `lib/news-desk/tagger.ts`), and BGM Looper processing runs a 1 GB Lambda for up to 60 s. Someone who wants those writes to the owner, and the owner grants a limited amount.

This reverses the Cognito spec's "Owner only" goal (`2026-09-28-cognito-login-design.md` §2). The owner asked for it on 2026-09-29, and that takes precedence.

## 2. Goals and non-goals

Goals:

- **Every gated request is decided by Amazon Verified Permissions**, from Cedar policies, with the Cognito user pool as the identity source. That includes the owner's requests.
- **Three levels of access:**
  - base access (Cognito group `friends`): see BGM Looper, Money Planner and News Desk, and use their free actions
  - metered grants: per user and per action, with a quota and an expiry, whichever runs out first
  - owner only, never grantable: Resume admin, Newsletter admin, Keystatic and the Access page
- **Grants are made from an owner-only Access page** at `/tools/access-admin`, not through Terraform. People who have signed in but have no access show up there as pending.
- **Revocation takes effect within 15 minutes.**
- **A domain address for requests**, `access@ashutosh-pandey.com`. Mail to it reaches the owner's Gmail, and the site emails invitees from it when their access changes.

Non-goals:

- SCIM provisioning, periodic access reviews, just-in-time admin access, more than one admin, and a break-glass bypass. These fit organisations with many users and an auditor. Here the Access page is the whole governance process.
- Ever granting Resume admin, Newsletter admin, Keystatic or the Access page to anyone but the owner.
- An email to the owner when someone new signs in. The invitee's written email is the request; the Pending list shows who is waiting.
- Caching authorization decisions. A cache would lengthen the revocation window.
- CloudTrail data events for Verified Permissions or DynamoDB. They are billed, and one admin doesn't need them.
- Email codes for invitees. The pool only lets an admin create native users, and an email code needs a native user, so Google is the invitees' first factor. They can add a passkey once signed in.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Authorization engine | Verified Permissions, one policy store, `validation_settings.mode = STRICT` | Externalized policy decisions in Cedar, as in the enterprise PDP/PEP model. STRICT rejects any policy that doesn't match the schema. |
| Identity in the decision | `IsAuthorizedWithToken` with the ID token; the Cognito identity source maps `sub` to `Site::User` and `cognito:groups` to `Site::Group` | Verified Permissions checks the token's signature, issuer, audience and expiry itself. |
| Where grants are recorded | Base access: Cognito groups. Metered grants: a DynamoDB table. | Cognito puts groups in the token, so no custom token Lambda is needed. A grant has a quota and expiry, which a group can't carry. |
| How grants are made | The owner-only Access page, through the Cognito and DynamoDB APIs | The owner doesn't want a `terraform apply` per grant. Terraform still owns the groups, the schema and the policies, which rarely change. |
| Terraform-only invites | Rejected | A Google user's Cognito account is only created at first sign-in, and its username comes from the Google account ID. Terraform can't add them to a group, or link them, ahead of time. |
| Quota enforcement | Cedar checks `context.grant.remaining > 0 && context.now < context.grant.expiresAt`; a DynamoDB conditional update then consumes one use | Verified Permissions is stateless and can't count. The conditional update means two requests racing for the last use can't both win. |
| Time in Cedar | Epoch seconds as `Long` | Avoids depending on which Cedar extension types Verified Permissions accepts. |
| Session | The ID and refresh tokens, encrypted with AES-256-GCM, in two cookies | The decision needs the token. The refresh token is a credential, so it is encrypted, not only signed. Two cookies because both together approach the 4 KB cookie limit. |
| Token lifetimes | ID token 15 min, refresh token 7 days | 15 minutes is the revocation window. 7 days matches today's session. |
| Enforcement point | `proxy.ts`, through a `(method, path) → (tool, action)` table in `route-gate.ts` | One place for every check. Next 16's proxy runs on Node.js, so the AWS SDK works there. |
| Unmapped gated path | Denied | Adding a route without deciding its action must fail, not open. A test enforces the mapping. |
| Failure mode | Fail closed after 2 s | A bypass on error would be the hole this design closes. The owner is locked out during an outage too, and accepts that. |
| Hub check | Parallel `IsAuthorizedWithToken` calls, one per tool | `BatchIsAuthorizedWithToken` costs $0.00015 a call, 30 single calls' worth; the hub needs 7. |
| Inbound mail | SES receiving → S3 → a forwarding Lambda → the owner's Gmail | Stays in AWS, costs almost nothing, and forwarding to the owner's verified address works in the SES sandbox. |
| Outbound mail | SESv2 `SendEmail` from `access@ashutosh-pandey.com`, after SES production access | Sending to invitees needs production access. |

## 4. Access model

### Entities

Namespace `Site`:

- `User`, the principal. Verified Permissions builds its ID as `<user pool ID>|<sub>`.
- `Group`, the principal's parents, from `cognito:groups`, with IDs `<user pool ID>|<group name>`. Terraform creates `owner` and `friends`. Cognito also puts every Google user into an automatic group, `<user pool ID>_Google`, which no policy mentions.
- `Tool`, the resource: `hub`, `bgm-looper`, `money-planner`, `news-desk`, `resume-admin`, `newsletter-admin`, `keystatic`, `access-admin`.

Because group IDs include the user pool ID, the policy files are Terraform templates, filled in with `templatefile()`. The tests fill them in with a fixed fake pool ID.

### Actions

| Action group | Actions |
|---|---|
| `free` | `view`, `newsdesk:pin` |
| `metered` | `looper:process`, `newsdesk:refresh`, `newsdesk:ask` |
| `ownerOnly` | `resume:draft`, `resume:extract`, `resume:publish`, `newsletter:send`, `keystatic:use`, `access:manage` |

Action context, declared in the schema:

- `now: Long`, always sent
- `grant: { remaining: Long, expiresAt: Long }`, optional, sent only for metered actions when a grant row exists

### Policies

```cedar
// 1. The owner can do everything.
permit (principal in Site::Group::"${pool}|owner", action, resource);

// 2. Friends: free actions on the hub and the three shareable tools.
permit (principal in Site::Group::"${pool}|friends", action in Site::Action::"free", resource)
when {
  resource in [Site::Tool::"hub", Site::Tool::"bgm-looper",
               Site::Tool::"money-planner", Site::Tool::"news-desk"]
};

// 3. Friends: metered actions, only with a live grant.
permit (principal in Site::Group::"${pool}|friends", action in Site::Action::"metered", resource)
when {
  context has grant &&
  context.grant.remaining > 0 &&
  context.now < context.grant.expiresAt
};

// 4. Safety net: no permit can open an owner-only action to anyone else.
forbid (principal, action in Site::Action::"ownerOnly", resource)
unless { principal in Site::Group::"${pool}|owner" };
```

A signed-in user in neither group matches no permit, so every request is denied. They are sent to `/access-requested`.

## 5. Session and enforcement

### Session

- `lib/auth.ts` replaces the timestamp cookie with two cookies. Both are `httpOnly`, `Secure`, `SameSite=Lax` and path `/`, and each is encrypted with AES-256-GCM under a key derived from `COOKIE_SECRET` with HKDF:
  - `site_id`: the ID token
  - `site_refresh`: the refresh token
- `looper_session` is removed. Every existing session ends when this ships, and the owner signs in once.
- `exchangeCode` in `lib/cognito.ts` returns the ID and refresh tokens, not only the ID token.
- The callback verifies the ID token with `aws-jwt-verify`, as now, then sets both cookies. It no longer checks `OWNER_EMAIL`: any Cognito user gets a session, and Verified Permissions decides what the session can do. `isOwner` is removed.
- **Refresh.** When the ID token has under 60 s left, the proxy posts the refresh token to `<COGNITO_DOMAIN>/oauth2/token` (`grant_type=refresh_token`, `client_id`; the client is public, so there is no secret). It sets the new `site_id` on the same response. If the refresh fails because the token was revoked or is past 7 days, both cookies are cleared and the request goes to `/login?next=…` (a page) or gets a 401 (an API).

### Route to action mapping

`lib/route-gate.ts` gains `ROUTE_ACTIONS`, keyed by method and path pattern. `GATED_PREFIXES` gains `/api/access`. `TOOLS` gains an Access entry.

| Method and path | Tool | Action | Consumes a use |
|---|---|---|---|
| `GET /tools` | `hub` | `view` | |
| `GET /tools/bgm-looper` | `bgm-looper` | `view` | |
| `POST /api/looper/upload-url` | `bgm-looper` | `looper:process` | no |
| `POST /api/looper/process` | `bgm-looper` | `looper:process` | yes |
| `GET /tools/money-planner` | `money-planner` | `view` | |
| `GET /tools/news-desk` | `news-desk` | `view` | |
| `POST /api/news-desk/indicators`, `DELETE /api/news-desk/indicators/[id]` | `news-desk` | `newsdesk:pin` | |
| `POST /api/news-desk/refresh` | `news-desk` | `newsdesk:refresh` | yes |
| `POST /api/news-desk/ask` | `news-desk` | `newsdesk:ask` | yes |
| `GET /tools/resume-admin` | `resume-admin` | `view` | |
| `GET`/`PUT /api/resume/draft`, `POST /api/resume/upload-url` | `resume-admin` | `resume:draft` | |
| `POST /api/resume/extract` | `resume-admin` | `resume:extract` | |
| `POST /api/resume/publish` | `resume-admin` | `resume:publish` | |
| `GET /tools/newsletter-admin` | `newsletter-admin` | `view` | |
| `POST /api/newsletter/send` | `newsletter-admin` | `newsletter:send` | |
| any `/keystatic/**`, `/api/keystatic/**` | `keystatic` | `keystatic:use` | |
| `GET /tools/access-admin`, any `/api/access/**` | `access-admin` | `access:manage` | |

The upload URL is checked against the grant but doesn't consume it, so one loop run costs one use, taken when processing starts. A gated path that matches no row is denied.

### What the proxy does

For a gated request:

1. No session → as today, `/login?next=…` or 401.
2. Refresh the ID token if needed (above).
3. Look up the route in `ROUTE_ACTIONS`. No match → deny.
4. For a metered action, read the grant row `(sub, action)` from DynamoDB, unless the user is in `owner`, who has no grant rows and isn't counted.
5. Call `IsAuthorizedWithToken` with the ID token, the action, `Site::Tool::"<tool>"` and `context`.
6. If allowed, the route consumes a use, and the user isn't in `owner`, run `UpdateItem SET used = used + 1` with the condition `used < limit AND expiresAt > :now`. If the condition fails, deny as quota exhausted.
7. Pass the request through.

A request that fails after step 6 (bad input, an OpenRouter error) has still used one call. That is simpler and errs toward keeping costs down.

The hub page makes one check per tool in parallel, using the action of that tool's page (`view`, or `keystatic:use` and `access:manage`), and lists only the allowed tools. For each metered action the user holds, it shows the uses left and the expiry.

### Denials

| Situation | Page | API |
|---|---|---|
| No session | redirect to `/login?next=…` | 401 `{error:"unauthorized"}` |
| Signed in, in neither group | redirect to `/access-requested` | 403 `{error:"no_access"}` |
| Action not allowed | 403 page with a request-access link | 403 `{error:"forbidden"}` |
| Metered: no grant, used up or expired | 403 page saying which | 403 `{error:"no_grant"}`, `"quota_exhausted"` or `"grant_expired"` |
| Verified Permissions or DynamoDB errors, or takes over 2 s | error page | 503 `{error:"authorization_unavailable"}` |

`/access-requested` sits outside the `(site)` route group, like `/login`. It says the account is waiting for approval and shows `access@ashutosh-pandey.com`. The request-access link on 403 pages is a `mailto:` with the subject `Access request: <tool> <action>` and a short body prompt: who you are, what you want to try, roughly how many times.

### What Verified Permissions doesn't check

It doesn't know whether a token was revoked or its user deleted. The 15-minute ID token covers that: removing a member also calls `AdminUserGlobalSignOut`, so their refresh token stops working and their access ends when the current ID token expires.

## 6. Grants and the Access page

### Table `site-access-grants`

DynamoDB, on-demand, defined in `access.tf`. It is shared by `dev`, `stage` and `main`, like the user pool: a grant belongs to a person, not an environment.

| Attribute | Type | Meaning |
|---|---|---|
| `sub` | S, partition key | Cognito user ID |
| `action` | S, sort key | `looper:process`, `newsdesk:refresh`, `newsdesk:ask` |
| `email` | S | for display |
| `limit` | N | uses allowed |
| `used` | N | uses consumed |
| `expiresAt` | N | epoch seconds |
| `grantedAt` | N | epoch seconds |
| `note` | S | free text, e.g. "emailed 2 Oct, wants to try the assistant" |
| `ttl` | N | `expiresAt` + 30 days; DynamoDB's TTL deletes the row |

Granting an action that already has a row overwrites it, so `used` starts again at 0.

### Page `/tools/access-admin`

Needs `access:manage`. Listed in `TOOLS` with kind "Site". Built in the portfolio's editorial design system, like the other admin pages.

- **Pending:** Cognito users in neither `owner` nor `friends`, with email and first sign-in date.
  - Approve: `AdminAddUserToGroup` to `friends`, then the approval email.
  - Dismiss: `AdminDeleteUser`. If they sign in again they reappear.
- **Members:** users in `friends`, each with their grants shown as "ask: 7 of 20 left, expires 9 Oct".
  - Grant: a metered action, a limit (default 20, 1–1000), an expiry in days (default 7, 1–90), and an optional note. `PutItem`, then the grant email.
  - Revoke grant: `DeleteItem`, then the access-ended email.
  - Remove member: `AdminRemoveUserFromGroup`, `AdminUserGlobalSignOut`, delete their grant rows, then the access-ended email.
- **Owner:** shown, read-only. The API refuses any change to a member of `owner`, so the owner can't be locked out from this page.

### API

All under `/api/access/*`, all mapped to `access:manage`, with inputs checked by zod.

| Route | Does |
|---|---|
| `GET /api/access/users` | pending users, members and their grants |
| `POST /api/access/members` `{sub}` | approve |
| `DELETE /api/access/members/[sub]` | remove member |
| `DELETE /api/access/pending/[sub]` | dismiss |
| `PUT /api/access/grants` `{sub, action, limit, expiresInDays, note?}` | grant |
| `DELETE /api/access/grants/[sub]/[action]` | revoke grant |

Listing users is `ListUsers` plus `AdminListGroupsForUser` for each. At a handful of users that is fine, and it keeps the Cognito groups as the only record of membership.

### Audit

Each change writes one structured log line to Vercel's logs: `{event:"access", by, op, target, action?, limit?, expiresAt?}`. The table's `grantedAt` and `note` record why each current grant exists.

## 7. Email

SES already holds `ashutosh-pandey.com` as a verified identity with DKIM and a DMARC record (`infra/shared/email.tf`).

### Receiving

- An MX record at the apex on Vercel DNS: `10 inbound-smtp.us-east-1.amazonaws.com`. The domain has no MX record today.
- A receipt rule set, made the account's active set in `us-east-1`, with one rule for the recipient `access@ashutosh-pandey.com`, spam and virus scanning on. It has two actions, in order:
  1. S3: the raw message goes to main's data bucket under `inbound-mail/`. A lifecycle rule for that prefix deletes objects after 30 days. The bucket policy lets `ses.amazonaws.com` write under the prefix, with `aws:SourceAccount` set to this account.
  2. Lambda: `mail_forwarder`, invoked asynchronously.
- No other address at the domain gets a rule.

`mail_forwarder` is Python 3.12, standard library plus the runtime's boto3, in `lambda/src/mail_forwarder/` with tests in `lambda/tests/`. Terraform packages it with `archive_file` and deploys it, so it is not part of the container image or `deploy.yml`. It:

- drops the message if SES's spam or virus verdict is `FAIL`
- reads the raw message from S3
- sets `From: Access request <access@ashutosh-pandey.com>`, since SES only sends from verified addresses and the original sender's DMARC would fail on a forward
- sets `Reply-To:` to the original sender
- prefixes the subject with `[access] `
- removes the headers SES would reject on resend (`Return-Path`, `Sender`, `Message-ID`, `DKIM-Signature`)
- sends it with `SendRawEmail` to `var.alert_email`

### Sending

- **SES production access** is requested once by hand, with `aws sesv2 put-account-details` or the console. The use case: transactional email to invited users of a personal site, when their access changes, a few a month. The rollout PR carries the exact text. Until it is granted, sends to anyone but the owner fail and the Access page says so.
- `aws_sesv2_account_suppression_attributes` with `BOUNCE` and `COMPLAINT`.
- From `Access <access@ashutosh-pandey.com>`, `Reply-To` the same address, so replies arrive through the receiving path.
- Three emails, plain text with a simple HTML version:
  1. Approved: which tools they can use, and a link to `/tools`.
  2. Grant: "You can use News Desk ask 20 times until 9 Oct 2026", plus any other grants they hold.
  3. Access ended: sent when a grant is revoked or a member is removed.
- A failed send doesn't undo the change. The page shows "Saved, but the email failed: <reason>".

## 8. Infrastructure

### `infra/shared/access.tf` (new)

- `aws_verifiedpermissions_policy_store.site`, `validation_settings { mode = "STRICT" }`
- `aws_verifiedpermissions_schema.site` from `infra/shared/cedar/schema.cedarschema.json`
- `aws_verifiedpermissions_identity_source.cognito`: the user pool ARN, `client_ids = [aws_cognito_user_pool_client.web.id]`, `group_configuration.group_entity_type = "Site::Group"`, `principal_entity_type = "Site::User"`
- `aws_verifiedpermissions_policy` × 4, from `infra/shared/cedar/policies/*.cedar` through `templatefile()` with the pool ID
- `aws_cognito_user_group` `owner` and `friends`
- `aws_cognito_user_in_group` putting `aws_cognito_user.owner` in `owner`
- `aws_dynamodb_table.access_grants`, `PAY_PER_REQUEST`, TTL on `ttl`
- An IAM policy on both Vercel roles, `aws_iam_role.vercel` (production) and `aws_iam_role.vercel_preview` (dev and stage), built from one statement list the way `vercel_resume_statements` is in `shared.tf`. Everything it grants is shared by the three environments, so it lives in `infra/shared`, not in `infra/modules/environment`:
  - `verifiedpermissions:IsAuthorizedWithToken` on the policy store
  - `cognito-idp:ListUsers`, `AdminListGroupsForUser`, `AdminAddUserToGroup`, `AdminRemoveUserFromGroup`, `AdminUserGlobalSignOut`, `AdminDeleteUser` on the user pool
  - `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query` on the table
  - `ses:SendEmail` on the domain identity, with the condition `ses:FromAddress = access@ashutosh-pandey.com`
- Vercel env vars for production and preview: `AVP_POLICY_STORE_ID`, `ACCESS_GRANTS_TABLE`, `ACCESS_FROM_EMAIL`

### `infra/shared/auth.tf`

- `aws_cognito_user_pool_client.web`: `id_token_validity = 15`, `access_token_validity = 15`, `refresh_token_validity = 7`, with `token_validity_units` of minutes, minutes and days. `enable_token_revocation = true`, the default, stated explicitly.
- `OWNER_EMAIL` stays as a Vercel env var for now and is no longer read by the callback. It is removed in PR 1's cleanup (§11).

### `infra/shared/email.tf`

- `vercel_dns_record` MX at the apex, with `team_id`
- `aws_ses_receipt_rule_set`, `aws_ses_active_receipt_rule_set`, `aws_ses_receipt_rule`
- the bucket policy statement on main's data bucket, which `shared` names with `local.data_bucket_names["main"]` rather than reading the env stack's state
- the `inbound-mail/` lifecycle rule, which goes in `infra/modules/environment/main.tf`'s `aws_s3_bucket_lifecycle_configuration.data` instead: S3 allows one lifecycle configuration per bucket and the module already owns it. The rule lands on all three buckets and is harmless on dev and stage, which get no mail. It reaches main's bucket when the change is promoted to `main`; until then stored mail does not expire.
- `aws_lambda_function.mail_forwarder` from `archive_file`, its role (`s3:GetObject` on `inbound-mail/*`, `ses:SendRawEmail` on the domain identity, CloudWatch Logs), and `aws_lambda_permission` for `ses.amazonaws.com` with `source_account`
- `aws_sesv2_account_suppression_attributes`

No new required variables. The CI apply role that applies `shared` (`aws_iam_role.tf_apply_prod` in `ci.tf`) has no `verifiedpermissions:*` or `dynamodb:*` today; a separate PR adds both before any of these resources (§11). `archive_file` needs the `hashicorp/archive` provider, which `backend.tf`'s `required_providers` and the lock file don't have yet; PR 3 adds it. `hashicorp/aws` is already at `~> 6.62`, which has the Verified Permissions resources.

### The owner's Google identity

The pool has one user today, the native owner user that Terraform creates, and no linked Google identity. If the owner signs in with Google, Cognito creates a second, separate user, which would be pending. PR 1 carries a one-time runbook step, `docs/runbooks/link-owner-google.md`:

1. Sign in once with Google, which creates `Google_<id>`.
2. Note `<id>` and delete that user with `admin-delete-user`.
3. `admin-link-provider-for-user` with the native owner user as the destination and `Google` / `Cognito_Subject` / `<id>` as the source.

After that, Google, email code and passkey all sign in as the same user, with one `sub`, in `owner`. A passkey registered to the deleted Google user is lost and has to be registered again.

## 9. Web

- `lib/auth.ts`: encrypted token cookies, `readSession(request)` returning `{idToken, refreshToken, sub, email, groups, expiresAt}` from the decrypted token's claims, and `setSession`/`clearSession`.
- `lib/cognito.ts`: `exchangeCode` returns both tokens; new `refreshTokens(refreshToken)`; `isOwner` removed.
- `app/api/auth/passkey/route.ts`: checks for a session with `readSession` instead of the old cookie. Invitees can add a passkey too.
- `lib/authz/`:
  - `authorizer.ts`: the `Authorizer` interface, `isAuthorized({session, tool, action, context}) → allow | deny`
  - `avp.ts`: the Verified Permissions implementation, with a 2 s timeout
  - `local.ts`: the in-process implementation used by e2e (§10)
  - `grants.ts`: read, put, delete and consume grant rows
- `lib/route-gate.ts`: `ROUTE_ACTIONS`, `actionFor(method, pathname)`, `/api/access` in `GATED_PREFIXES`, the Access entry in `TOOLS`.
- `proxy.ts`: the flow in §5.
- `lib/access-admin.ts`: the Cognito calls behind the Access API.
- `lib/access-mail.ts`: the three emails.
- `app/access-requested/page.tsx`, a 403 page, `app/tools/access-admin/page.tsx`, the `/api/access/*` route handlers.
- `app/tools/page.tsx`: lists only allowed tools and shows grant usage.
- New dependencies: `@aws-sdk/client-verifiedpermissions`, `@aws-sdk/client-cognito-identity-provider`, `@aws-sdk/client-dynamodb`, `@aws-sdk/client-sesv2`. Dev dependencies: `@cedar-policy/cedar-wasm`, `aws-sdk-client-mock`.

## 10. Testing

- **Cedar, offline** (Vitest with `@cedar-policy/cedar-wasm`). The tests load the real schema and policy files with a fake pool ID substituted, validate the policies against the schema, and check a table of cases:
  - owner, friend, pending and Google-group-only users
  - every action on every tool
  - for metered actions: no grant, an active grant, a used-up grant, an expired grant
  - a friend with an active grant is still denied every `ownerOnly` action, which is what the `forbid` guarantees
- **Route coverage:** a test lists every `app/**/route.ts` and every page under a gated prefix, and fails if one has no `ROUTE_ACTIONS` row.
- **Unit:**
  - cookie encryption round trip; a tampered or truncated cookie is rejected
  - refresh when under 60 s remain; the session is cleared when refresh fails
  - the proxy sends the right `context` for metered actions and none for others
  - consumption: the conditional update losing a race returns `quota_exhausted` (with `aws-sdk-client-mock`)
  - fail-closed on a timeout and on an error from Verified Permissions or DynamoDB
  - Access API: input validation, and the refusal to change an `owner` member
  - email bodies and a failed send leaving the change in place
- **`mail_forwarder`** (pytest): header rewriting, `Reply-To`, the subject prefix, removed headers, and dropping `FAIL` verdicts.
- **e2e.** Today's specs forge a session cookie with `E2E_COOKIE_SECRET`. They now forge an encrypted session holding an unsigned test token whose claims set `sub` and `cognito:groups`. The proxy uses the `local` authorizer, which runs the same Cedar files in-process with cedar-wasm and trusts the groups in the session. It is not a bypass, because it applies the same policies. `local` is used only when `AUTHZ_MODE=local` and `VERCEL` is unset; if `AUTHZ_MODE=local` is set on Vercel, the proxy denies every gated request. New specs:
  - a friend sees three tools on the hub and gets 403 on Resume admin
  - a pending user is sent to `/access-requested`
  - the owner sees every tool
  - the Access page's approve, grant and revoke flows, with the AWS calls mocked at the route boundary
- **Manual, on `dev`:**
  1. Sign in with a second Google account → `/access-requested`.
  2. Approve it on the Access page → it sees three tools; the approval email arrives.
  3. Grant `newsdesk:ask` with a limit of 2 → two asks succeed, the third gets `quota_exhausted`.
  4. Remove the member → access ends within 15 minutes.
  5. Email `access@ashutosh-pandey.com` from that account → it reaches the owner's Gmail, and Reply goes to the sender.

## 11. Rollout

One CI-permissions PR, then three parts, in order. Terraform runs in CI: a PR that touches `infra/` gets a plan posted by the `Terraform` workflow, and a push to `dev` applies `shared`, so everything in §8 reaches production when it merges to `dev`. The Vercel deployment for that same push is created before the apply finishes and keeps the env vars it was created with, so a web change that reads a new env var cannot ship in the same PR that creates it. Each part therefore lands its Terraform in its own PR first, waits for the apply on `dev`, and then merges the web change.

0. **CI permissions.** `verifiedpermissions:*` and `dynamodb:*` on `tf_apply_prod`. Merged and applied before part 1's infra PR, because a role cannot reliably use a permission granted in the same apply.

1. **Authorization core.**
   - First, prove that `awsCredentials()` (`@vercel/oidc-aws-credentials-provider`) gets credentials inside `proxy.ts` on a `dev` deployment. Every check in §5 depends on it, and the Vercel OIDC token has so far only been used from route handlers. If it doesn't work, the checks move out of the proxy into a shared `authorize()` called by each gated route handler and each gated page's layout, with the same `ROUTE_ACTIONS` table; the rest of the design stays the same.
   - Infra: the policy store, schema, identity source, policies, groups, owner membership, token lifetimes, Vercel env vars, and the IAM statements for Verified Permissions. The table and the SES statements wait for PRs 2 and 3.
   - Web: the token session and refresh, `lib/authz/`, `ROUTE_ACTIONS`, the proxy checks, `/access-requested`, the 403 page, hub filtering, and removal of `isOwner`.
   - Metered actions work only for the owner at this point, since no grants exist.
   - Order: the infra PR (Cedar files and the Terraform; it only adds), then the web PR once `dev`'s apply has run. The shorter token lifetimes reach production with the infra PR; the current callback checks the ID token once and keeps its own 7-day cookie, so that is safe. Every session ends when the web change deploys; the owner signs in again.
   - The runbook for linking the owner's Google identity.
   - After it reaches `main`, remove the `OWNER_EMAIL` Vercel env var. The plan for that PR destroys a resource, so CI's apply stops and needs a manual `apply-destroys` run of the `Terraform` workflow.
2. **Grants and the Access page.** The table, the grant context and consumption in the proxy, the Access page and its API, and the IAM statements for Cognito admin calls and DynamoDB.
3. **Email.** The MX record, receipt rules, `mail_forwarder`, the suppression list, the SES send permission, the three emails, and the production access request with its text.

Docs updated along the way: `CLAUDE.md` (what `route-gate.ts` now holds, the new env vars), `.claude/rules/infra.md` (the receipt rule set is account-wide, the forwarder deploys through Terraform), the header comment in `infra/shared/email.tf` (it says the account stays in the SES sandbox, which PR 3 ends), `.claude/rules/web.md` (the session format and `AUTHZ_MODE`), `ARCHITECTURE.md`, and `CHANGELOG.md` under `[Unreleased]` in each PR.

## 12. Cost

Assumed monthly use: 10,000 gated requests, 300 hub loads, 1,000 DynamoDB reads and writes, 50 emails in and 50 out.

| Item | Price | Monthly |
|---|---|---|
| Verified Permissions checks | $0.000005 each; 10,000 + 300 × 7 hub checks | $0.061 |
| DynamoDB on-demand | $0.625 per million writes, $0.125 per million reads | < $0.01 |
| SES sending | $0.10 per 1,000 | $0.005 |
| SES receiving | $0.10 per 1,000 emails, $0.09 per 1,000 incoming 256 KB chunks | $0.01 |
| `mail_forwarder` Lambda, S3 | inside the free tier | $0 |
| **Total** | | **about ₹8 ($0.08)** |

At ₹96.07 to the dollar (29 September 2026). The existing `$5` budget alarm covers all of it.
