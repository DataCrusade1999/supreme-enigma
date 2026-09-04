# Portfolio Site — Newsletter (Phase 3) — Design Spec

Date: 2026-08-01

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

- `POST /v1/emails` creates an email; without an explicit status it's
  created as a draft. Setting `status` to the send-immediately value
  requires an explicit `X-Buttondown-Live-Dangerously: true` header on
  the first send per API key — a deliberate safety guard on Buttondown's
  side, consistent with treating sends as a serious, confirmed action.
- Email objects support a client-settable `slug` field and an arbitrary
  `metadata` field. This repo uses `slug` (matched to the newsletter
  issue's own slug) as the correlation key for "was this issue already
  sent."
- Webhooks exist (`email.sent`, etc.) but are not used by this design —
  see §4 for why the simpler direction (site → Buttondown) was chosen
  over a webhook-driven Buttondown → site sync.

Cost: $0. Buttondown's free tier plus this app's existing Next.js API
routes on Vercel — no new AWS resource, no database, no hosting change.

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
  components/
    newsletter/
      IssueList.tsx              ← presentational, sync, props-based, tested
      IssueBody.tsx               ← presentational, sync, props-based, tested
      SubscribeForm.tsx            ← presentational, sync, tested (renders a <form>, submits nowhere in tests)
  app/
    newsletter-admin/
      page.tsx                    ← gated, async Server Component, force-dynamic
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
  email with this `slug` already exists in Buttondown (e.g.
  `GET /v1/emails?slug=<slug>` or list-and-filter, whichever the actual
  installed API surface supports — pin this against Buttondown's real,
  current API reference as the first implementation step, not assumed
  from this spec, the same discipline the blog spec applied to
  Keystatic's reader API).
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

- `/newsletter`: thin async Server Component, reads all `newsletter`
  entries via `getReader()`, sorts by `date` descending, renders
  `IssueList` (title, date, summary per entry, linking to
  `/newsletter/[slug]`) followed by `SubscribeForm`.
- `/newsletter/[slug]`: thin async Server Component, reads one entry,
  passes `title`/`date` and resolved MDX body to `IssueBody` for
  rendering via `next-mdx-remote/rsc`'s `<MDXRemote>` — same
  children-prop pattern as blog's `PostBody`, so `MDXRemote` never enters
  a tested component. Exports `generateStaticParams`, same reasoning as
  blog (prerender at build time, matches this app's existing pages).
- `SiteHeader`'s nav gains a `Newsletter` link, positioned between Blog
  and Contact.
- `SubscribeForm`: a plain `<form method="post" action="https://buttondown.com/api/emails/embed-subscribe/<username>">`
  with a single email `<input>`, styled to match the site's existing form
  elements (see the login page's `<input>`/`<button>` classes for the
  established look). No client-side JS required for the subscribe flow
  itself. The Buttondown username is a public, non-sensitive value (it's
  part of a public URL) — hardcode it as a constant in the component,
  updated once the real Buttondown account exists.

## 8. Admin page and send flow

`/newsletter-admin` (gated, same shared password as `/keystatic` and
`/tools/bgm-looper`):

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
3. Calls `isIssueSent(slug)` again, immediately before sending — closes
   the race where the admin page's last render is stale (a second tab, a
   rapid double-click) by re-verifying right before the irreversible
   action. If already sent, responds with a clear "already sent" error
   and does not call `sendIssue`.
4. Otherwise calls `sendIssue({ slug, subject: title, body: content })`.
5. Returns success or a clear error — the caller (the admin page) must
   not treat a network-level ambiguity as success.

## 9. Auth

`/newsletter-admin` and `/api/newsletter/*` are added to the existing
gated-prefix list in `app/lib/route-gate.ts` — same shared-password
cookie, no new auth mechanism, consistent with how `/keystatic` is gated.
`/newsletter` and `/newsletter/[slug]` are public, like `/blog`.

## 10. Testing

- `IssueList`/`IssueBody`/`SubscribeForm`: ordinary React Testing Library
  render tests with fixture data, same pattern as `BlogList`/`PostBody`.
  `SubscribeForm`'s test asserts the form's `action` URL and input
  presence — it does not (and cannot, in jsdom) actually submit to
  Buttondown.
- `app/lib/buttondown.ts`: unit tests mocking the underlying `fetch` call —
  covers `isIssueSent` returning both true and false, `sendIssue`
  constructing the correct request shape, and both functions throwing
  (not silently resolving) on a non-success API response.
- `/api/newsletter/send`: tests for the double-send guard (mocked
  "already sent" → the route rejects without calling `sendIssue`), the
  happy path (mocked "not sent" + successful send → 200), and a
  Buttondown-failure passthrough (mocked send failure → the route returns
  a clear error, not a silent success).
- `route-gate.test.ts`: new cases for `/newsletter-admin` (gated) and
  `/api/newsletter/*` (gated).
- `SiteHeader.test.tsx` extended to assert the new `Newsletter` nav link.
- `/newsletter`, `/newsletter/[slug]`, and `/newsletter-admin` page files
  are not unit-tested directly (thin wrappers, or in `/newsletter-admin`'s
  case, live-data-dependent) — covered by the build succeeding for the two
  public pages (same reasoning as blog: `generateStaticParams` exercised
  against real content), and by manual verification for the admin page
  and the actual send action, which can only be checked against a live
  Buttondown account, not automated in CI.

## 11. Housekeeping

- `BUTTONDOWN_API_KEY` is added to Vercel **manually via its dashboard**,
  not through `infra/main/*.tf`, following the same convention as the 4
  Keystatic env vars (Task-10-documented in the blog plan) — avoids a
  written-down secret anywhere in this repo's tracked files. Needed in
  whichever Vercel environment scopes will actually exercise the send
  flow (at minimum Preview, matching how the Keystatic vars were rolled
  out; add to Production before this reaches `main`, same lesson learned
  from the blog phase).
- `CHANGELOG.md`'s `[Unreleased]` section gets an entry for this phase.
- The real Buttondown account, its username (for the embed form's action
  URL), and its API key are a one-time manual setup step outside this
  plan — analogous to blog's GitHub App setup. The implementation plan's
  final task should report this handoff clearly, the same way blog's
  Task 10 did.

## 12. Out of scope (this phase)

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
