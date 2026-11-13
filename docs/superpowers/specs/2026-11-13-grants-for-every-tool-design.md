# Grants for every tool, and one set of access emails

Date: 2026-11-13. Follows the access-control design (`2026-09-29-access-control-design.md`, #300), which shipped in v1.10.0 and v1.11.0.

## Why

The first real use of the Access page on production (2026-11-13) showed three problems.

1. Approval opens more than the owner meant to give. Approving someone puts them in `friends`, and `friends-free.cedar` lets that group use every free action in BGM Looper, Money Planner and News Desk. So an approved person can use all of Money Planner and read News Desk without a grant, and the owner never decided that per person.
2. The approval email names "BGM Looper, Money Planner and News Desk", which reads as full access to all three. BGM Looper without a processing grant can't do anything.
3. The emails and the Access page have rough edges: "1 uses", two closing "reply" lines, an expiry date with no time, a sender called "Access", grants that expired weeks ago shown as if live, and a grant form that keeps the last person's values.

The owner wants every tool to need a grant, one welcome email when someone is first given something, short emails after that, and emails that look like the site.

## Goals

- Approval opens no tool. It moves a person from Pending to Members so the owner can give them grants.
- Every tool a member opens needs a live grant for that tool.
- One welcome email on a member's first grant ever; a short update email on each later grant; a short ended email on revoke and on remove. Nothing on approval.
- Each email links straight to the tool it is about.
- HTML email in the site's editorial look (direction A, canvas https://claude.ai/artifact/Nzakge9nvHEYsBG5CrmPdA), with a plain-text part.
- The eight Access page and email fixes listed under "Fixes", in the same PR.

## Non-goals

- No email when a grant runs out by itself (expiry or last use). The owner revokes or re-grants by hand.
- No change to the owner's access, the owner-only tools, or the `forbid` guard.
- No migration of existing members' access. They keep their live grants and lose the free access approval used to give.
- No greeting by name. The site knows only the email address.
- No email on dev or stage: `ACCESS_FROM_EMAIL` and the send grant stay production only (#511).

## Anti-goals

- An email that tells someone they can use something they can't, or can't use something they can.
- A paid action that can be used without a grant, or a grant whose uses aren't counted.
- An access change that fails, or reports "nothing was changed", because an email failed.

## Grants

Two kinds, both rows in the existing `site-access-grants` table (key `sub` + `action`):

| Kind | Actions | Uses | Expiry | Opens |
|---|---|---|---|---|
| Time-only | Money Planner, News Desk reading | none | yes | its tool |
| Uses and time (as today) | `newsdesk:ask`, `newsdesk:refresh`, `looper:process` | yes | yes | its tool, plus the action |

Names for the two new actions are the builder's (for example `moneyplanner:use`, `newsdesk:read`). A time-only row has no `limit`/`used`, or the builder marks it another way; `consume` is never called for it.

What a live grant opens:

- A member may open a tool's page (`view`) while they hold any unexpired grant on that tool. A spent paid grant (no uses left, not expired) still opens the page, so the person sees "no uses left" rather than a denial.
- News Desk pinning (`newsdesk:pin`) goes with opening News Desk.
- A paid action still needs its own grant with a use left and no expiry passed, as today.
- The `/tools` hub stays open to every member and lists only the tools they can open now. A member with nothing live sees an empty hub that says so.

Cedar: `friends-free.cedar` shrinks to the hub. A new policy lets `friends` take `view` and `newsdesk:pin` on a tool when the request carries a live tool grant in its context (for example `context.access.expiresAt > context.now`). The proxy computes that from the member's grants for the tool; how (one query per request, or a read of the specific rows) is the builder's call, within the proxy's current latency. The schema, `route-gate.ts` and the policy tests change together, as they do now.

Grant form on the Access page: picking a time-only action hides the uses field.

## Emails

All three are sent from `Ashutosh Pandey <access@ashutosh-pandey.com>` with Reply-To `access@`, which reaches the owner's Zoho inbox. A failed send never undoes the change; the response carries `emailError` and the page shows it, as now.

**Welcome**, on a member's first grant ever.
- Subject: "Welcome. <Tool> is ready for you".
- Masthead ("Ashutosh Pandey" in italic serif, "Tools · Access" right), the line "Welcome, and thank you for signing in.", a thank-you sentence, and "sign in with the same Google account".
- One row per grant made: tool name in serif, then what it allows, uses (paid only) and the expiry with its time in IST ("until 20 Nov 2026, 6:43 pm IST"), and a teal "Open <Tool>" button linking to the tool's page.
- The line "Your access is always shown at ashutosh-pandey.com/tools.", and a footer: "Questions, or want more uses? Reply to this email." plus why they're getting it.

**Update**, on every later grant. Two wordings, by whether the grant opens a tool the member couldn't open just before it (no unexpired grant on that tool):
- Opens a new tool: subject "You can now use <Tool>", heading "One more tool is open to you."
- The tool was already open (a top-up, a re-grant, refresh added to ask): subject "Your access to <Tool> has changed", heading "Your access to <Tool> has changed."
- Both: same masthead, the one grant's row and button, "Everything else you had stays as it was.", "Questions? Reply to this email."

**Ended**, on revoke and on remove, only when something live was taken away: a revoke of an unexpired grant, or a remove of a member holding at least one unexpired grant. Clearing an expired row, or removing someone who had nothing live, sends nothing.
- Revoke: "Your access to <action> on ashutosh-pandey.com has ended."
- Remove: "Your access to the tools on ashutosh-pandey.com has ended."
- Same masthead and footer, no button.

"First grant ever": the first grant that triggers an email for this member. Record that the welcome went out (a marker row in the grants table that the grant lists ignore, or a builder's equivalent) when it sends successfully. If the send fails, send the welcome again on the next grant. Removing a member clears the marker with their grants, so someone removed and approved again is welcomed again.

Build rules for the HTML: table layout and inline styles, 600 px wide, so Gmail, Outlook and Apple Mail render it. Web fonts are not loaded in most clients: Instrument Serif falls back to Georgia, IBM Plex Sans to Helvetica/Arial. Light only. Escape every value that comes from data. The plain-text part carries the same words and the URLs in full.

Tool links come from `TOOLS` in `route-gate.ts` (`href`), so a renamed route can't leave a dead link.

## Fixes (the eight items)

1. Singular "use" for one use, in emails and on the Access page.
2. One closing reply line per email.
3. Expiry shown with its time in IST, in emails and on the Access page.
4. A grant's note stays private to the owner; emails never show it.
5. Sender display name "Ashutosh Pandey".
6. No hard-coded tool list: each email names only the tools in it and links to each.
7. The Access page marks expired and used-up grants as such (greyed, "expired 31 Oct" or "used up") instead of "2 of 2 left, expires 31 Oct". Rows stay 30 days after expiry by design (`GRANT_TTL_S`), so this is a display fix, not a TTL fix. Revoke on an expired row stays available to clear it.
8. The grant form resets to its defaults after each grant, and each member's form starts from the defaults.

Also in this PR (builder's call to include): the grant list read uses `ConsistentRead: true` (#516), since the update email depends on it.

## Constraints

- **Ordering in production.** The Cedar policies live in `infra/prod/account` (through `infra/modules/auth`), which CI applies from `dev`. Merging this PR to `dev` changes production's policies at once, while production's web code changes only when it reaches `main`. Until then the old proxy sends no tool-grant context, so production members can't open any tool page; paid actions keep working. The owner accepted that gap (2026-11-13): one PR, promoted to `main` the same day it merges to `dev`.
- Significant infra change (Cedar): the PR gets a devops release-readiness review before merge.
- `CHANGELOG.md` entry under `[Unreleased]`; the issue is filed before the PR, which closes it and #516.
- After production ships, the owner checks with a second account: welcome on first grant, update on second, ended on revoke, a reply reaching Zoho, and that an approved member with no grant opens nothing but the hub.

## Decided by the owner

- Every tool needs a grant; approval opens none.
- Money Planner grants are time-only (no uses).
- Welcome on first grant, short update on later grants, short ended email on revoke and remove, nothing on approval.
- Ended emails only when something live was taken away; the update's wording says "has changed" when the tool was already open; the welcome points to `/tools` for access, not "remaining uses".
- Direction A (editorial) for the emails.
- All eight fixes in one issue and one PR.
- A paid grant also opens its tool; News Desk reading is its own time-only grant for people who only read.
- The hub stays open to every member and lists only what they can open.
- Existing members aren't migrated.
- One PR, accepting the production gap between the `dev` merge and the `main` promotion.

## Builder's calls already made (owner may change)

- A spent but unexpired paid grant still opens the tool page.
- "First grant ever" is tracked with a marker that survives grant expiry and is cleared on remove; a failed welcome send is retried on the next grant.
- Sender display name "Ashutosh Pandey".
- #516 is folded in.

## Left to the builder

- Action names for the two time-only grants, and how a time-only row is stored.
- How the proxy finds a member's live grant for a tool.
- The email template code (one shared layout for the three emails is expected).
- Exact subject wording beyond the shapes above.
