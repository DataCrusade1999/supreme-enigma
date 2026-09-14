# Portfolio Site — Newsletter (Phase 3) — Design Spec

Date: 2026-08-01. Revised 2026-09-14 — §2, §6, §7, §8, §9, §10, §11 and §12
updated for the `/tools` hub, the editorial redesign and the Playwright suite,
none of which existed when this was written. Tracked as issue #29.

## 1. Purpose

Add a newsletter to the portfolio site (built in Phase 1: `docs/superpowers/specs/2026-08-01-portfolio-site-shell-design.md`;
blog in Phase 2: `docs/superpowers/specs/2026-08-01-portfolio-blog-design.md`), without adding
any server, database, or AWS resource. Two parts: a public archive of past
issues on the site itself, and a subscribe embed plus send automation
backed by an external free-tier email service. Actual sending and
deliverability are handled off-site — this repo never touches SMTP,
bounce handling, or a subscriber database.

## 2. Tool choice: Buttondown

Buttondown is a Markdown-first newsletter service with a free tier (up to
100 subscribers), a plain HTML form-POST subscribe embed (no JS SDK
required), and a REST API for creating and sending emails
(`docs.buttondown.com`, API base `https://api.buttondown.com/v1`).
Verified before this spec was written, not assumed:

- `POST /v1/emails` creates an email. **Corrected 2026-09-14:** this spec
  originally said that without an explicit status it is created as a draft.
  The published schema says the opposite — `EmailInput.status` carries
  `"default": "about_to_send"`, so a create call that omits `status` sends to
  every subscriber. The design is unaffected (the one function that creates an
  email always sets `status` explicitly), but the safety property is the
  reverse of what was assumed and is now a hard constraint in the plan: no
  `POST /v1/emails` call anywhere may leave `status` unset. Setting the
  send-immediately value also wants `X-Buttondown-Live-Dangerously: true`,
  sent unconditionally rather than relying on Buttondown's
  confirmed-once-per-key carve-out.
- `POST /v1/emails/{id}/publish` exists, offering a two-step
  create-draft-then-publish alternative. Not adopted — see §12.
- Email objects support a client-settable `slug` field and an arbitrary
  `metadata` field. This repo uses `slug` (matched to the newsletter
  issue's own slug) as the correlation key for "was this issue already
  sent."
- Webhooks exist (`email.sent`, etc.) but are not used by this design —
  see §4 for why the simpler direction (site → Buttondown) was chosen
  over a webhook-driven Buttondown → site sync.

Cost: $0. Buttondown's free tier (first 100 subscribers, re-confirmed
2026-09-14) plus this app's existing Next.js API routes on Vercel — no new AWS
resource, no database, no hosting change.

## 3. Content model

One new Keystatic collection, `newsletter`, alongside the existing `blog`
collection in `app/keystatic.config.ts`. Same storage mechanism as blog:
GitHub-mode, `path: "content/newsletter/*"`, repo-root content directory
(sibling to `app/`, for the same `process.cwd()` reasons documented in the
blog design spec §4 — the existing `getReader()` wrapper in
`app/lib/keystatic-reader.ts` already resolves this correctly for any
collection registered in the shared config, no changes needed there).

| Field | Type | Notes |
|---|---|---|
| `title` | `fields.slug` | doubles as the slug source |
| `date` | `fields.date` | publish date, used for sort order and as the send date shown in the archive |
| `summary` | `fields.text` | one-line description, shown in the archive list |
| `content` | `fields.mdx` | issue body |

No `tags` field — not obviously useful for a newsletter archive; can be
added later without a schema migration concern if wanted.

**Constraint on content, not enforced in code:** `fields.mdx()` technically
allows embedding custom JSX components, which blog's rendering pipeline
(`next-mdx-remote/rsc`, this app's own React tree) can handle. Buttondown's
parser only understands plain Markdown/HTML — it has no concept of a JSX
component. Newsletter content must stay plain-Markdown-only in practice, or
the emailed version will render broken. Document this in the Keystatic
field's label/description text; building actual validation for it is not
proportionate to a personal newsletter's needs.

## 4. Why site → Buttondown, not Buttondown → site

Two directions were considered for keeping the site archive and the sent
email in sync:

- **Site → Buttondown (chosen):** author the issue once in `/keystatic`
  (git-backed, same editor as blog), publish it to the archive, then
  explicitly trigger a send from a small admin page in this app, which
  calls Buttondown's create-email API with that content. Content is
  written exactly once; this app's git history stays the single source of
  truth for the writing itself.
- **Buttondown → site:** compose and send in Buttondown first; a webhook
  (`email.sent`) notifies an API route in this app, which commits the sent
  content into `content/newsletter/*.mdx` via the GitHub API.

Site → Buttondown was chosen: it needs no webhook receiver, no signature
verification, and no second GitHub write credential (Keystatic's own
GitHub App handles all git writes today, via the user's own browser
session — this app's backend currently has zero GitHub write capability,
and adding one only for this feature is more moving parts for the same
outcome).

## 5. Send trigger: manual, not automatic

Sending is a human-triggered action from a gated admin page, not automatic
on every `content/newsletter/*.mdx` commit. Emails are irreversible once
sent to subscribers; a typo fix, a draft-in-progress commit, or an
unrelated edit to an already-sent issue's file must never trigger a real
send. The only place a send can be initiated is an explicit button click
after the editor has reviewed the rendered issue.

## 6. Architecture

```
app/
  keystatic.config.ts          ← MODIFIED: adds the `newsletter` collection
  lib/
    buttondown.ts               ← NEW: the one place that talks to Buttondown's API
    route-gate.ts               ← MODIFIED: one TOOLS entry, one new API prefix
  components/
    newsletter/
      IssueList.tsx              ← presentational, sync, props-based, tested
      IssueBody.tsx               ← presentational, sync, props-based, tested
      SubscribeForm.tsx            ← presentational, sync, tested; one `variant` prop, page-width or rail
      IssueRail.tsx                 ← presentational, sync, tested (send date, newer/older, subscribe)
      SendButton.tsx                ← client component, tested
  app/
    tools/
      newsletter-admin/
        page.tsx                  ← gated by the /tools namespace, async Server Component, force-dynamic
    api/
      newsletter/
        send/route.ts              ← gated POST endpoint
    (site)/
      newsletter/
        page.tsx                    ← thin async Server Component: reads + renders IssueList + SubscribeForm
        [slug]/page.tsx               ← thin async Server Component: reads + renders IssueBody
content/
  newsletter/                    ← Keystatic-managed .mdx files land here (repo root, same as content/blog/)
```

No new npm dependency: Buttondown's API is a plain REST/JSON API, called
with the runtime's built-in `fetch` — no SDK needed.

### `app/lib/buttondown.ts`

The one module that knows about Buttondown's API shape, mirroring how
`keystatic-reader.ts` is the one module that knows about the content
reader's shape. Two functions:

- `isIssueSent(slug: string): Promise<boolean>` — looks up whether an
  email with this `slug` already exists in Buttondown. Settled 2026-09-14
  against the real OpenAPI spec: `GET /v1/emails` has **no** `slug` query
  parameter, so this is list-and-filter, paging through `next` until it is
  `null`. It deliberately does not narrow by `?status=sent` either — a
  just-triggered send sits in `about_to_send`, `throttled` or `in_flight`
  before it becomes `sent`, so filtering on `sent` would report an in-flight
  issue as unsent and allow a second send. Any email carrying the slug counts,
  whatever state it is in.
- `sendIssue({ slug, subject, body }): Promise<void>` — calls
  `POST /v1/emails` with `slug` set to the issue's own slug, `subject` set
  to the issue's title, `body` set to the issue's rendered Markdown
  content, and the status/header combination required to send
  immediately rather than create a draft. Throws on any non-success
  response — callers must not assume success from a resolved promise
  alone without checking this.

Both functions read `BUTTONDOWN_API_KEY` from the environment
(server-only, no `NEXT_PUBLIC_` prefix) and fail loudly (throw) if it's
missing, rather than silently no-op — a missing key must surface as a
build/runtime error the first time it's exercised, not a silently-broken
send button.

## 7. Public pages

Both pages use the site's existing editorial language rather than a newsletter-
specific one: `PageMasthead` for the page opening, `font-display` headings, the
12-column row rhythm from `BlogList`. `IssueList` is `BlogList` minus the tag
column.

- `/newsletter`: thin async Server Component, reads all `newsletter`
  entries via `getReader()`, sorts by `date` descending, opens with
  `<PageMasthead eyebrow="Writing" title="Newsletter" />`, then renders
  `IssueList` (title, date, summary per entry, linking to
  `/newsletter/[slug]`) followed by `SubscribeForm`.
- `/newsletter/[slug]`: thin async Server Component. It passes `title`/`date`
  and the resolved MDX body to `IssueBody` via `next-mdx-remote/rsc`'s
  `<MDXRemote>` — same children-prop pattern as blog's `PostBody`, so
  `MDXRemote` never enters a tested component — plus an `<IssueRail />` as
  `IssueBody`'s `rail` prop. Exports `generateStaticParams`, same reasoning as
  blog (prerender at build time, matches this app's existing pages).

  **The reading column has a counterweight rail.** `IssueBody` places the
  article in columns 1–6 (measure still capped at `max-w-xl`, 576px — the right
  length for 15px text) and the rail in columns 9–12, stacking below `lg` where
  there is no spare width. The rail carries three things: when the issue went
  out to subscribers, the newer and older issues, and the subscribe form.
  Without it a 576px column on a 1440px page leaves the right two-thirds empty
  and the whitespace reads as accidental rather than composed.

  **This splits `/newsletter/[slug]` from `/blog/[slug]`, on purpose.** The two
  were deliberately identical in the first draft of this spec. The rail is the
  reason to diverge: a newsletter has between-issue navigation and a standing
  subscribe call, and a blog answers both through tags and its list page.
  `/blog/[slug]` keeps its single narrow column, unchanged — revisiting that is
  its own issue, not this phase's work.

  **No issue number anywhere.** It was considered for the rail and dropped: the
  content model (§3) has `title`, `date`, `summary`, `content` and nothing else,
  and deriving a number from position in the sorted list would silently renumber
  every issue the first time one was deleted. The send date is a real field and
  does the same anchoring job.

  **The rail degrades to almost nothing, correctly.** The newest issue has no
  newer neighbour, the oldest has no older one, and while the archive holds only
  the seed issue there are no neighbours at all — in that last case the whole
  "More issues" block is absent and the rail is a send date and a subscribe
  form. No dead links, no empty headed section.
- `SiteHeader`'s nav gains a `Newsletter` link, positioned between Blog
  and Contact, and `COMMANDS` in `app/lib/site/commands.ts` gains a matching
  `cd newsletter` row in the same position. The command list is hand-written
  rather than derived from the nav or from `TOOLS`, so a page added to one
  surface and not the other is only half-reachable.
- `SubscribeForm`: rendered at page width on `/newsletter` and inside the rail
  on `/newsletter/[slug]`, as one component with a `variant` prop rather than
  two copies — the `action` URL and the Buttondown username must exist in
  exactly one file, or the manual username swap (§11) fixes one and misses the
  other. A plain `<form method="post" action="https://buttondown.com/api/emails/embed-subscribe/<username>">`
  with a single email `<input>`, styled with the login page's own
  `<input>`/`<button>` classes — the only other place on the site that asks a
  visitor to type something — including their 44px minimum hit targets. No client-side JS required for the subscribe flow
  itself. The Buttondown username is a public, non-sensitive value (it's
  part of a public URL) — hardcode it as a constant in the component,
  updated once the real Buttondown account exists.

## 8. Admin page and send flow

`/tools/newsletter-admin` (gated, same shared password as every other tool):

Placement is deliberate. `app/lib/route-gate.ts` gates the whole `/tools`
namespace, so a page put there is behind the password by location rather than by
someone remembering to list it; a top-level `/newsletter-admin` would invert
that. The page is also registered as a `TOOLS` entry, which is the single list
the `/tools` hub, the login page's "Continuing to → X" strip and the tools e2e
spec all read. Its chrome copies `/tools/resume-admin` — the two tools should be
indistinguishable in layout — including the trailing `<CommandBar />`, which is
load-bearing rather than decorative: `/tools/*` pages render outside the
`(site)` route group and so carry no `SiteHeader`, making ⌘K their only
navigation. `COMMANDS` also gains an `open newsletter-admin` row, so the tool is
reachable by name from anywhere on the site.

- Async Server Component, **not** statically generated
  (`export const dynamic = 'force-dynamic'`) — its content depends on live
  external state (Buttondown's current sent/unsent status per issue), and
  forcing it dynamic is also what keeps `npm run build` from ever calling
  Buttondown's real API during CI/static generation.
- Reads all `newsletter` entries via the same reader used by `/newsletter`.
- For each entry, calls `isIssueSent(slug)` server-side to determine its
  status.
- Renders a list: title, date, sent/unsent/unknown status, and (for
  unsent issues) a `SendButton` client component that POSTs the slug to
  `/api/newsletter/send` and reflects the result (success → status
  updates to sent; failure → shows the error, does not assume success).
- If a status check itself fails (Buttondown unreachable, etc.), that
  issue shows "status unknown," not "unsent" — never default to a state
  that looks safe to send when it isn't verified.

`/api/newsletter/send` (gated POST):

1. Takes `{ slug }` in the request body.
2. Re-reads that issue's content fresh from the reader — never trusts
   client-supplied title/body, only the slug to look up.
3. Holds a per-slug in-flight claim for the duration of the request, then
   calls `isIssueSent(slug)` again immediately before sending. **Corrected
   2026-09-14 — the earlier wording here overclaimed.** It said re-verifying
   "closes the race" where the admin page's last render is stale (a second
   tab, a rapid double-click). It does not: two requests can both pass the
   check before either creates the email, and a send is irreversible. The
   in-flight claim closes that window on a single instance, which covers the
   realistic triggers. It does **not** close it across instances — Vercel runs
   this route on more than one, and the claim is per-instance. Closing that
   needs either durable state (ruled out by §6 — no database, no new AWS
   resource) or a verified guarantee that Buttondown rejects a duplicate
   client-supplied `slug`, which is unconfirmed. Tracked as a known
   limitation, not a solved problem. If already sent, responds with a clear
   "already sent" error and does not call `sendIssue`.
4. Otherwise calls `sendIssue({ slug, subject: title, body: content })`.
5. Returns success or a clear error — the caller (the admin page) must
   not treat a network-level ambiguity as success.

## 9. Auth

`/tools/newsletter-admin` needs no new gated prefix — `/tools` is already one.
Only `/api/newsletter` is added to `GATED_PREFIXES` in `app/lib/route-gate.ts`,
since `/api/` also holds ungated routes and those prefixes stay explicit. Same
shared-password cookie, no new auth mechanism; enforcement is `app/proxy.ts`
(Next 16's rename of `middleware.ts`), which answers an ungated `/api/` request
with a 401 and a page request with a redirect to `/login`.
`/newsletter` and `/newsletter/[slug]` are public, like `/blog`.

## 10. Testing

- `IssueList`/`IssueBody`/`IssueRail`/`SubscribeForm`: ordinary React Testing
  Library render tests with fixture data, same pattern as `BlogList`/`PostBody`.
  `SubscribeForm`'s test asserts the form's `action` URL and input presence in
  both variants — it does not (and cannot, in jsdom) actually submit to
  Buttondown. `IssueBody` is tested with and without a `rail`. `IssueRail` is
  tested with both neighbours, with one, and with none — the last is the state
  the site is actually in until a second issue exists.
- `app/lib/buttondown.ts`: unit tests mocking the underlying `fetch` call —
  covers `isIssueSent` returning both true and false, `sendIssue`
  constructing the correct request shape, and both functions throwing
  (not silently resolving) on a non-success API response.
- `/api/newsletter/send`: tests for the double-send guard (mocked
  "already sent" → the route rejects without calling `sendIssue`), the
  happy path (mocked "not sent" + successful send → 200), and a
  Buttondown-failure passthrough (mocked send failure → the route returns
  a clear error, not a silent success).
- `route-gate.test.ts`: new cases for `/api/newsletter/*` (gated),
  `/tools/newsletter-admin` (gated by the namespace — pinned so moving the page
  out of `/tools` fails loudly), `/newsletter` and `/newsletter/[slug]` (public),
  and a `toolNameFor` case for the new `TOOLS` entry.
- `SiteHeader.test.tsx` extended to assert the new `Newsletter` nav link, and
  `CommandBar.test.tsx` to assert the `cd newsletter` and
  `open newsletter-admin` rows. The command list is hand-written, not derived
  from `TOOLS`, so it does not come for free.
- **Playwright, which is half of CI's `test` gate:** `/newsletter` and
  `/newsletter/hello-newsletter` are added to `e2e/pages.spec.ts` and
  `e2e/a11y.spec.ts`, a Newsletter click-through to `e2e/navigation.spec.ts`, and
  the new hub row plus its command-bar route to `e2e/tools.spec.ts`. The e2e
  environment has no `BUTTONDOWN_API_KEY`, so the admin page renders
  "Status unknown" there by design — assertions must not depend on a "Send"
  button appearing, which would tie the suite to a live Buttondown account.
- `/newsletter`, `/newsletter/[slug]`, and `/tools/newsletter-admin` page
  files are not unit-tested directly (thin wrappers, or in the admin's case,
  live-data-dependent) — covered by the build succeeding and by Playwright for
  the two public pages, and by Playwright reaching the admin page's heading and
  rows. The one thing no automated check covers is the actual send, which can
  only be verified against a live Buttondown account with a real subscriber
  list; that stays a manual step in the handoff.

## 11. Housekeeping

- `BUTTONDOWN_API_KEY` is added to Vercel **manually via its dashboard**,
  not through `infra/main/*.tf`, following the same convention as the
  Keystatic env vars (Task-10-documented in the blog plan) — avoids a
  written-down secret anywhere in this repo's tracked files. Needed in
  whichever Vercel environment scopes will actually exercise the send
  flow (at minimum Preview, matching how the Keystatic vars were rolled
  out; add to Production before this reaches `main`, same lesson learned
  from the blog phase).
- `CHANGELOG.md`'s `[Unreleased]` section gets an entry for this phase.
- Issue #29 ("Portfolio Site — Phase 3: Newsletter") already tracks this work;
  the implementation PR targets `dev` and closes it. No new issue is needed.
- The real Buttondown account, its username (for the embed form's action
  URL), and its API key are a one-time manual setup step outside this
  plan — analogous to blog's GitHub App setup. The implementation plan's
  final task should report this handoff clearly, the same way blog's
  Task 10 did.

## 12. Out of scope (this phase)

- Switching the send to `POST /v1/emails/{id}/publish` (create an explicit
  draft, then publish). Arguably the safer shape, since the irreversible step
  becomes its own call. Not adopted: the endpoint's entire published
  documentation is the string "Publish an email", and it takes a required
  `EmailUpdateInput` body whose semantics for this use are unspecified —
  trading a verified one-call path for an unverified two-call one. Worth
  revisiting if Buttondown documents it.
- Tag filtering/search on the archive.
- RSS feed for the newsletter.
- Editing or resending an already-sent issue (Buttondown's own dashboard
  is the tool for that if ever needed; not duplicated here).
- Any change to how Keystatic commits content (still no `branchPrefix`,
  still commits to `dev` — the same open product question flagged during
  Phase 2 about publish lag through the `dev → stage → main` promotion
  chain applies equally to newsletter issues, and remains unresolved
  pending a separate decision).
- Subscriber list management, import/export, or analytics — entirely
  Buttondown's own dashboard.
