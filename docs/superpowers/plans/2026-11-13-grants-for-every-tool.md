# Grants for every tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approval opens no tool; each tool needs a live grant; access emails become welcome (first grant), update (later grants) and ended (revoke, remove), as editorial HTML with a text part; plus the eight Access page and email fixes and #516.

**Architecture:** A grant registry in `route-gate.ts` maps each grant key to its tool and kind (metered or time-only). The proxy and the hub derive a per-tool `context.access` (latest unexpired grant on that tool) from one consistent query of the member's grants, and a new Cedar policy lets `friends` view a tool only with it. Emails render from one shared table-based layout.

**Tech Stack:** Next.js 16 / React 19, Cedar via Verified Permissions (`@cedar-policy/cedar-wasm` locally), DynamoDB (`@aws-sdk/lib-dynamodb`), SESv2, Vitest, Playwright, Terraform.

**Spec:** `docs/superpowers/specs/2026-11-13-grants-for-every-tool-design.md`. Issue #518 (also closes #516).

## Global Constraints

- One branch `feat/grants-for-every-tool` from `dev`, one PR into `dev`, `Closes #518` and `Closes #516`, squash-merged after the `merging-a-pr` skill. It changes Cedar, so it gets a devops release-readiness review before merge.
- Merging to `dev` applies the Cedar change to production at once (`infra/prod/account` is applied from `dev`); production members can't open tool pages until the web code reaches `main`. Owner accepted this gap: promote `dev → stage → main` the same day, each promotion with the owner's OK.
- Sender: `Ashutosh Pandey <access@ashutosh-pandey.com>`, Reply-To `access@ashutosh-pandey.com`. `ACCESS_FROM_EMAIL` stays production only.
- Time format everywhere: `20 Nov 2026, 6:43 pm IST` (`en-GB`, `Asia/Kolkata`, 12-hour, lower-case am/pm). Uses: `1 use`, `20 uses`.
- A grant's `note` never appears in an email.
- No email when a grant runs out by itself; no email on approval or dismiss; no ended email when nothing unexpired was taken away.
- A failed email never fails or undoes the change: the response is `{ ok: true, emailError }` (existing `changed()`).
- Email HTML: table layout, inline styles, 600 px, light only; Georgia for the serif, Helvetica/Arial for the sans; every data value escaped; a plain-text part with full URLs.
- Rows stay 30 days after expiry (`GRANT_TTL_S`), unchanged.

## Review Focus

1. A member whose only grant on a tool has expired opens that tool's page: denied with `grant_expired`, and the hub doesn't list it. Test in Task 4.
2. A paid grant with no uses left but not expired: the page opens, the action is denied `quota_exhausted`. Test in Task 4.
3. The welcome send fails: no marker is written, and the next grant sends the welcome again. Test in Task 6.
4. Re-granting a key a member already holds: it replaces the row, sends the update email (not a second welcome), and the Access page shows the new values. Test in Task 6.
5. The grants query fails in the proxy on a tool page: denied `authorization_unavailable` (fail closed), never allowed. Test in Task 4.

---

### Task 1: Grant registry and formatting

**Files:**
- Modify: `web/lib/route-gate.ts`, `web/lib/route-gate.test.ts`
- Create: `web/lib/access-format.ts`, `web/lib/access-format.test.ts`

**Interfaces:**
- Produces, in `route-gate.ts`:
  - `GRANT_KEYS = ["newsdesk:read", "newsdesk:ask", "newsdesk:refresh", "looper:process", "moneyplanner:use"] as const`, `type GrantKey`.
  - `GRANTS: Record<GrantKey, { tool: ToolId; label: string; metered: boolean }>` with labels `News Desk reading`, `News Desk ask`, `News Desk refresh`, `BGM Looper processing`, `Money Planner`; `metered` true for the three in `METERED_ACTIONS`.
  - `newsdesk:read` and `moneyplanner:use` are grant keys only: not `ActionId`s, not Cedar actions, never passed to the authorizer. `isMetered` widens to `(action: ActionId | GrantKey)`.
  - `GRANTABLE_TOOLS: ToolId[]` = `["bgm-looper", "money-planner", "news-desk"]` (derived from `GRANTS`).
  - `METERED_ACTIONS`, `MeteredAction`, `isMetered` stay; `METERED_LABELS` is removed and its users switch to `GRANTS[key].label`.
  - `toolHref(tool: ToolId): string` from `TOOLS`.
- Produces, in `access-format.ts` (no server imports; the client Access page uses it): `formatUntil(epochSeconds: number): string`, `formatUses(n: number): string`, `formatDay(epochSeconds: number): string` (`31 Oct`).

- [ ] **Step 1: Failing tests.** `access-format.test.ts`: `formatUntil(1_795_180_380)` → `"20 Nov 2026, 6:43 pm IST"`; `formatUses(1)` → `"1 use"`, `formatUses(20)` → `"20 uses"`, `formatUses(0)` → `"0 uses"`; `formatDay` of 31 Oct 2026 IST → `"31 Oct"`. `route-gate.test.ts`: every `GrantKey` has a `GRANTS` entry whose `tool` is in `TOOLS`; `GRANTS[k].metered === isMetered(k)`; `GRANTABLE_TOOLS` equals the three tools; `toolHref("news-desk")` → `"/tools/news-desk"`.
- [ ] **Step 2: Run** `cd web && npx vitest run lib/access-format.test.ts lib/route-gate.test.ts` → FAIL (missing exports).
- [ ] **Step 3: Implement** both. `formatUntil` takes `formatToParts` from `Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })` and joins `day`, `month`, `year`, `hour`, `minute`, `dayPeriod` with its own separators (`20 Nov 2026, 6:43 pm IST`), never the formatter's literal spacing, which differs across ICU builds. Replace `METERED_LABELS` imports (`my-grants.ts`, `AccessAdmin.tsx`, `access-mail.ts`, `grants/[sub]/[action]/route.ts`) with `GRANTS[...].label`; `npx tsc --noEmit` finds them.
- [ ] **Step 4: Run** the two files, then `npx tsc --noEmit` → PASS, no errors.
- [ ] **Step 5: Commit** `feat(access): grant registry and shared date/use formatting (#518)`.

### Task 2: Grant store: time-only rows, consistent reads, welcome marker

**Files:**
- Modify: `web/lib/authz/grants.ts`, `web/lib/authz/grants.test.ts`

**Interfaces:**
- Consumes: `GrantKey`, `GRANTS` (Task 1).
- Produces:
  - `Grant = { sub; action: GrantKey; email; limit?: number; used?: number; expiresAt; grantedAt; note? }` (`limit`/`used` present only for metered keys).
  - `isLive(g: Grant, now: number): boolean` (unexpired and, if metered, `used < limit`), `isUnexpired(g, now)`.
  - `GrantStore` gains `wasWelcomed(sub): Promise<boolean>` and `markWelcomed(sub, now): Promise<void>`; `get`/`remove` take `GrantKey`; `consume` stays `MeteredAction`.
  - `list(sub)` returns grants only (never the marker); `removeAll(sub)` also deletes the marker.
- Marker: a row `{ sub, action: "_welcomed", at }` with no `ttl`. `list` drops it (filter, or a key condition that excludes it).

- [ ] **Step 1: Failing tests** in `grants.test.ts` (both stores, as the file already does for the Dynamo mock and the memory store): `list` sends `ConsistentRead: true`; a time-only `put` has no `limit`/`used`; `list` omits the marker; `wasWelcomed` false → `markWelcomed` → true; `removeAll` deletes grants and marker; `isLive` for metered used-up (false), time-only unexpired (true), expired (false).
- [ ] **Step 2: Run** `npx vitest run lib/authz/grants.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Update callers that assume `limit`/`used` exist (`my-grants.ts`, `proxy.ts` `meteredDenial`, `AccessAdmin.tsx`, `access-mail.ts`, `app/api/access/grants/route.ts`) only enough to compile; their behaviour changes in Tasks 4 and 7.
- [ ] **Step 4: Run** the file and `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(access): time-only grants, consistent grant reads, welcome marker (#518, #516)`.

### Task 3: Cedar: every tool needs a grant

**Files:**
- Modify: `infra/modules/auth/cedar/schema.cedarschema.json`, `infra/modules/auth/cedar/policies/friends-free.cedar`
- Create: `infra/modules/auth/cedar/policies/friends-tools.cedar`
- Modify: `web/lib/authz/authorizer.ts`, `web/lib/authz/avp.ts`, `web/lib/authz/avp.test.ts`, `web/lib/authz/policies.test.ts`, `web/lib/authz/local.test.ts`

**Interfaces:**
- Produces: `AuthzContext = { now; grant?: { remaining; expiresAt }; access?: { expiresAt: number } }`. `avp.ts` maps `access` to a record `{ expiresAt: long }`; local mode passes the context through as now.
- Schema: every action's context gains optional `access: { expiresAt: Long }`.
- `friends-free.cedar`: `view` on the hub only. Keep its scope exactly as it is (`principal in friends, action in free, resource`) and narrow it in the `when` clause (`resource == Site::Tool::"hub" && action == Site::Action::"view"`): Verified Permissions updates a static policy's conditions in place but not its principal or resource scope, so a scope change would show as a replace.
- `friends-tools.cedar`: `permit (principal in friends, action in [Site::Action::"view", Site::Action::"newsdesk:pin"], resource) when { resource in [bgm-looper, money-planner, news-desk] && context has access && context.now < context.access.expiresAt };` (`${pool}` templating as the other files).
- `friends-metered.cedar` unchanged.

- [ ] **Step 1: Failing tests** in `policies.test.ts`: the policy list is `["friends-free", "friends-metered", "friends-tools", "owner-all", "owner-only-guard"]`; friends may view `hub` with no context; friends may not view or pin the three tools without `access`, with `access.expiresAt = NOW` (expired), and may with `NOW + 3600`; friends with `access` still may not view the owner-only tools; metered rules unchanged; owner unchanged. Extend `decide()` to take `access`. `avp.test.ts`: `access` reaches `contextMap`. `local.test.ts`: through `createLocalAuthorizer` (real Cedar files, `validateRequest: true`), a friend with `access: { expiresAt: now + 60 }` may view `money-planner`, and without it may not.
- [ ] **Step 2: Run** `npx vitest run lib/authz` → the new cases FAIL.
- [ ] **Step 3: Implement** the schema, policies and context mapping.
- [ ] **Step 4: Run** `npx vitest run lib/authz` → PASS; strict validation passes. Other suites that assume free tools (proxy, hub, e2e) are updated in Tasks 4 and 8.
- [ ] **Step 5: Commit** `feat(authz): friends need a live grant to open any tool (#518)`.

### Task 4: Proxy and hub use tool access

**Files:**
- Create: `web/lib/authz/tool-access.ts`, `web/lib/authz/tool-access.test.ts`
- Modify: `web/app/tools/page.tsx`, `web/app/tools/page.test.tsx`, `web/proxy.ts`, `web/proxy.test.ts`, `web/lib/authz/visible-tools.ts`, `web/lib/authz/visible-tools.test.ts`, `web/lib/authz/my-grants.ts`, `web/lib/authz/my-grants.test.ts`, `web/app/access-denied/page.tsx`, `web/app/access-denied/page.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `toolAccess(grants: Grant[], tool: ToolId, now: number): { expiresAt: number } | undefined` — the latest `expiresAt` among unexpired grants whose `GRANTS[action].tool === tool` (a used-up metered grant counts).
  - `Denial` gains `"no_tool_grant"`; access-denied copy for it: `"You don't have access to that tool yet."`.
- Proxy: for a non-owner request whose `route.tool` is in `GRANTABLE_TOOLS` and whose action is `view` or `newsdesk:pin`, read `list(sub)` once, set `context.access`. A failed read → `authorization_unavailable`. A deny on those actions → `grant_expired` when the member has a grant on the tool but none unexpired, else `no_tool_grant`. Metered requests keep the `get` + `consume` path.
- `visibleTools()`: for a non-owner, one `list(sub)` (failure → hub shows only what needs no access), then per tool pass `access: toolAccess(...)` in the context.
- The hub page: with no tools to list, it shows `Nothing is open to this account yet. Write to access@ashutosh-pandey.com to ask.` (the address a `mailto:` link).
- `myGrants()` returns `isLive` grants; `describeGrant` → metered `News Desk ask: 2 of 20 uses left, until 20 Nov 2026, 6:43 pm IST`, time-only `Money Planner: until 20 Nov 2026, 6:43 pm IST` (format helpers from Task 1).

- [ ] **Step 1: Failing tests.** `tool-access.test.ts`: none → undefined; expired only → undefined; two unexpired → the later expiry; used-up metered unexpired → counts; another tool's grant → ignored. `proxy.test.ts` (friend session, mocked store and authorizer): page with live grant → next; no grant → redirect `reason=no_tool_grant`; only an expired grant → `reason=grant_expired`; `list` throws → `authorization_unavailable`; used-up unexpired `newsdesk:ask` → page opens, `POST /api/news-desk/ask` → `quota_exhausted`; owner → no `list` call. `visible-tools.test.ts`: the context carries `access` per tool. `my-grants.test.ts`: the two `describeGrant` strings above. `access-denied/page.test.tsx`: the `no_tool_grant` copy. `app/tools/page.test.tsx`: no visible tools → the empty-hub line and the `mailto:` link.
- [ ] **Step 2: Run** those files → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` → PASS (whole suite: Task 3's policy changes reach these).
- [ ] **Step 5: Commit** `feat(authz): open a tool from its live grant; hub lists what the member can open (#518)`.

### Task 5: Email layout and the three emails

**Files:**
- Create: `web/lib/access-mail-layout.ts`, `web/lib/access-mail-layout.test.ts`
- Modify: `web/lib/access-mail.ts`, `web/lib/access-mail.test.ts`

**Interfaces:**
- Consumes: `GRANTS`, `toolHref`, `formatUntil`, `formatUses`, `Grant`, `AccessUser`.
- Produces:
  - `renderEmail(p: { heading: string; intro?: string; rows: { tool: string; detail: string; button?: { label: string; href: string } }[]; after?: string; footer: string[] }): { html: string; text: string }`.
  - `sendWelcome(user: AccessUser, grant: Grant): Promise<string | null>`, `sendUpdate(user, grant, opensTool: boolean): Promise<string | null>`, `sendEnded(user, what: string): Promise<string | null>`. `sendApproved` and `sendGrants` are removed.
- Copy (exact):
  - Welcome subject `Welcome. <Tool> is ready for you`; heading `Welcome, and thank you for signing in.`; intro `Thanks for trying the tools on my site. I've opened the one below for you. Sign in with the same Google account you used before.`; after `Your access is always shown at ashutosh-pandey.com/tools.`; footer `Questions, or want more uses? Reply to this email.` and `You're getting this because you signed in at ashutosh-pandey.com and were given access.`
  - Update with `opensTool` true: subject `You can now use <Tool>`, heading `One more tool is open to you.`; with `opensTool` false: subject `Your access to <Tool> has changed`, heading `Your access to <Tool> has changed.`; both: after `Everything else you had stays as it was.`; footer `Questions? Reply to this email.`
  - Ended subject `Your access on ashutosh-pandey.com has ended`; heading `Your access to <what> on ashutosh-pandey.com has ended.`; no rows; footer `Questions? Reply to this email.` Remove uses `what = "the tools"`, revoke `GRANTS[key].label`.
  - Row: tool = the tool's name from `TOOLS`; detail = metered `<label> · <n use(s)> · until <time>`, time-only `until <time>`; button `Open <Tool>` → `https://ashutosh-pandey.com` + `toolHref`.
  - Masthead: `Ashutosh Pandey` (italic serif) and `Tools · Access`.
- `FromEmailAddress`: `Ashutosh Pandey <${ACCESS_FROM_EMAIL}>`.

- [ ] **Step 1: Failing tests.** Layout: html escapes a heading `A & <b>` to `A &amp; &lt;b&gt;`; html has a `<table` root and `width="600"`; text contains the button URL in full and every row's detail; no `<style>` block. Senders (SES mocked as now): welcome subject `Welcome. News Desk is ready for you`, text contains `News Desk ask · 20 uses · until 20 Nov 2026, 6:43 pm IST` and `https://ashutosh-pandey.com/tools/news-desk`; a one-use grant says `1 use`; a time-only Money Planner grant's detail is `until …` with no uses; the note never appears in html or text; From is `Ashutosh Pandey <access@ashutosh-pandey.com>`; update subjects for `opensTool` true and false, and the ended subject, as above; the existing missing-address, missing-env and SES-error tests stay.
- [ ] **Step 2: Run** `npx vitest run lib/access-mail-layout.test.ts lib/access-mail.test.ts` → FAIL.
- [ ] **Step 3: Implement** the layout after the canvas's direction A (https://claude.ai/artifact/Nzakge9nvHEYsBG5CrmPdA, board "A · Editorial"): paper `#eceae5` body, ink `#111110`, muted `#5f5d57`, rule `rgba(17,17,16,0.18)`, teal `#146b64` button with white text.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(access): welcome, update and ended emails in the editorial layout (#518)`.

### Task 6: Access API sends the right email

**Files:**
- Modify: `web/lib/access-api.ts`, `web/lib/access-admin.ts`, `web/lib/access-admin.test.ts`, `web/app/api/access/members/route.ts`, `web/app/api/access/members/[sub]/route.ts`, `web/app/api/access/grants/route.ts`, `web/app/api/access/grants/[sub]/[action]/route.ts`, `web/app/api/access/routes.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4 (`toolAccess`) and 5.
- Produces:
  - `grantBody`: `action: z.enum(GRANT_KEYS)`; `limit` optional, 1–1000, defaulting to 20 for metered keys and dropped for time-only keys; `expiresInDays` 1–90, default 7; `note` ≤ 200.
  - `grantAction` reads the member's grants before the put and returns `{ user, grant, opensTool }`, where `opensTool` is `toolAccess(before, GRANTS[grant.action].tool, now) === undefined`; it writes time-only rows without `limit`/`used`.
  - `revokeGrant(sub, key: GrantKey)` returns `{ user, removed: Grant | null }` (the row read before the delete). `removeMember(sub)` returns `{ user, hadLive: boolean }` (any unexpired grant before `removeAll`).
  - Approve returns `{ ok: true }` and sends nothing. Grant: `wasWelcomed` false → `sendWelcome`, and on `null` → `markWelcomed`; true → `sendUpdate(user, grant, opensTool)`. A failure reading or writing the marker is logged and falls back to `sendUpdate`'s path without failing the change. Revoke → `sendEnded(user, GRANTS[key].label)` only when `removed` is unexpired. Remove → `sendEnded(user, "the tools")` only when `hadLive`. Dismiss → nothing. `liveGrants()` is deleted.

- [ ] **Step 1: Failing tests** in `routes.test.ts` (replace the email block): approve sends nothing; first grant → `sendWelcome(user, grant)` then `markWelcomed`; welcome returns an error → `markWelcomed` not called and `emailError` returned; a second grant on a new tool after the marker → `sendUpdate(…, true)`; re-grant of the same key, or `newsdesk:refresh` while `newsdesk:ask` is unexpired → `sendUpdate(…, false)`; `wasWelcomed` throws → change still `200`; revoke of an unexpired grant and remove of a member with a live grant → `sendEnded` with `"News Desk ask"` and `"the tools"`; revoke of an expired grant, and remove of a member with only expired grants or none → no `sendEnded`; dismiss → nothing; `PUT` with `moneyplanner:use` and no `limit` → `200` and `grantAction` called without a limit; `PUT` with an unknown key → `400`.
- [ ] **Step 2: Run** `npx vitest run app/api/access` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(access): welcome on first grant, update after, ended on revoke and remove (#518)`.

### Task 7: Access page

**Files:**
- Modify: `web/components/access/AccessAdmin.tsx`, `web/components/access/AccessAdmin.test.tsx`

**Interfaces:**
- Consumes: `GRANT_KEYS`, `GRANTS`, `isLive`, `isUnexpired`, the format helpers.
- Row text: live metered `News Desk ask: 2 of 20 uses left, until 20 Nov 2026, 6:43 pm IST`; live time-only `Money Planner: until …`; used up `News Desk ask: used up, until …`; expired `News Desk ask: expired 31 Oct`. Used-up and expired rows are muted (`text-muted`) and keep their Revoke button.
- `change()` returns `Promise<boolean>` (true on a 2xx). `GrantForm` resets action, uses, days and note to `newsdesk:ask`, `20`, `7`, `""` after a grant that returned true. The action select lists every `GrantKey` by label; the Uses field is not rendered for a time-only key.

- [ ] **Step 1: Failing tests:** the four row texts above (with a fixed `Date.now`); expired and used-up rows carry the muted class; selecting `Money Planner` removes the Uses field; after a successful grant the form shows `20`, `7` and an empty note; after a failed grant it keeps what was typed.
- [ ] **Step 2: Run** `npx vitest run components/access` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(access): show expired and used-up grants as such; reset the grant form (#518)`.

### Task 8: e2e, docs, PR, release, production check

**Files:**
- Modify: `web/e2e/access.spec.ts`, `.claude/rules/web.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-09-29-access-control-design.md` (one line pointing at the new spec)

- [ ] **Step 1: e2e.** Replace "a friend's hub lists only the shareable tools" with: a friend with no grant sees none of the seven tools on `/tools`, and `/tools/money-planner` redirects to `/access-denied?reason=no_tool_grant&tool=money-planner&action=view`. Keep the other specs.
- [ ] **Step 2: Docs.** `.claude/rules/web.md`: the metered-actions bullet describes the two grant kinds, `GRANTS` in `route-gate.ts`, `context.access`, and that `friends` open nothing but the hub without a grant. `ARCHITECTURE.md` Auth section: same in two sentences, and the three emails. `CHANGELOG.md` `[Unreleased]`: `### Changed` — approval no longer opens any tool, every tool needs a grant (Money Planner and News Desk reading are time-only), access emails are welcome/update/ended in the site's look (#518); `### Fixed` — grant emails read grants consistently (#516).
- [ ] **Step 3: Verify.** `cd web && npm test && npm run lint && npx tsc --noEmit`, then the build with the dummy Keystatic vars and `npm run test:e2e`. Expected: all green (local Windows e2e has shown first-test launch timeouts; CI's Linux run is the gate).
- [ ] **Step 4: Commit, push, PR** into `dev`. The spec and this plan are committed on the branch in the first commit (`docs: grants-for-every-tool spec and plan (#518)`) if they aren't already with the docs commit first and a `web/` commit last (Vercel builds only when the last commit touches `web/`). Body: summary, the production-gap note, `Closes #518`, `Closes #516`.
- [ ] **Step 5: Merge** via `merging-a-pr`: on this PR the `Terraform` plan covers `prod/account`, `dev/account` and `dev/app`; each `account` stack shows the schema updated in place, `friends-free` updated in place and `friends-tools` created, nothing else, and `dev/app` shows `No changes`. A replace of `friends-free` means its scope changed: fix the policy, don't merge past it. `stage/account` shows the same diff on the `dev → stage` promotion PR; devops review (significant: Cedar) must be `Standard Deployment`; Codex findings triaged.
- [ ] **Step 6: Promote** `dev → stage → main` the same day, each with the owner's OK, then merge the changelog-sync PR with `--merge`. Until `main` ships, tell the owner not to approve or grant on production. If a promotion stalls (a non-`Standard Deployment` review is a hard stop), open a PR on `dev` that reverts only the Cedar files, so production's policies match its web code again.
- [ ] **Step 7: Production check** with the owner's second account: approved, no grant → hub empty, Money Planner denied; grant Money Planner 1 day → welcome email, Money Planner opens; grant News Desk ask 1 use → update email `You can now use News Desk` saying `1 use`; grant News Desk refresh → `Your access to News Desk has changed`; revoke ask → ended email; revoke one of the old expired 31 Oct grants → no email; reply to one → lands in Zoho; the Access page shows the old 31 Oct grants as expired.
