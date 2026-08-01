# Portfolio Site — Blog (Phase 2) — Design Spec

Date: 2026-08-01

## 1. Purpose

Add a blog to the portfolio site (built in Phase 1: `docs/superpowers/specs/2026-08-01-portfolio-site-shell-design.md`),
editable through a real admin UI instead of hand-written MDX files, without
adding any server, database, or AWS resource. Newsletter (Phase 3) is a
separate future spec, not built here.

## 2. Tool choice: Keystatic (GitHub mode)

Keystatic is a git-backed headless CMS: content is stored as files in this
repo, and the admin UI commits changes via the GitHub API rather than
running its own database or backend process. Two storage modes exist;
this phase uses **GitHub mode** over local mode, so posts can be written
from the deployed site itself, not only from a local checkout.

Cost: $0. GitHub mode uses GitHub's API (via a GitHub App you authorize)
and the app's own Next.js API routes on Vercel (already in use) — no new
AWS resource, no new hosting, no database. Stays inside the 200 INR/month
budget with no marginal cost.

## 3. One-time manual setup (not automatable, human action required)

Keystatic's GitHub mode requires an interactive GitHub login to create and
authorize a GitHub App — this cannot be scripted by an implementer or CI.
After the code in this spec ships:

1. Pull the branch locally, run `APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev` from `app/`.
2. Visit `http://localhost:3000/keystatic`, log in with GitHub.
3. Click "Create GitHub App", name it, authorize it on the
   `DataCrusade1999/supreme-enigma` repo.
4. Keystatic writes `KEYSTATIC_GITHUB_CLIENT_ID`,
   `KEYSTATIC_GITHUB_CLIENT_SECRET`, `KEYSTATIC_SECRET`, and
   `NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG` into a local `.env` file.
5. Copy those same 4 values into the Vercel project's environment
   variables so `/keystatic` also works on the deployed site.

Until this is done, `/keystatic` will not be usable in production (it will
still build and deploy — GitHub mode just won't be able to authenticate).
This is analogous to Phase 1's `resume.pdf`/contact-URL follow-ups: a
real, disclosed gap for the human to close, not a defect in the code.

## 4. Architecture

```
app/
  keystatic.config.ts       ← collection schema + GitHub-mode storage config
  lib/
    keystatic-reader.ts      ← createReader() wired to the repo root (see below)
  components/
    blog/
      BlogList.tsx            ← presentational, sync, props-based, tested
      PostBody.tsx             ← presentational, sync, props-based, tested
  app/
    keystatic/
      keystatic.ts           ← "use client"; makePage(config)
      layout.tsx              ← renders <KeystaticApp />
      [[...params]]/page.tsx  ← required catch-all route, renders null
    api/
      keystatic/
        [...params]/route.ts  ← makeRouteHandler(config) — GET/POST
    (site)/
      blog/
        page.tsx               ← thin async Server Component: reads + renders BlogList
        [slug]/page.tsx         ← thin async Server Component: reads + renders PostBody
content/
  blog/                     ← Keystatic-managed .mdx files land here (repo root, NOT app/content/ — see below)
```

New npm dependencies: `@keystatic/core`, `@keystatic/next`, `@markdoc/markdoc`
(Keystatic's own peer dependency), `next-mdx-remote` (renders the `fields.mdx()`
body — Keystatic stores MDX content but deliberately leaves rendering to the
consuming app).

### Content path: why `content/blog/` sits at the repo root, not `app/content/`

GitHub-mode writes go through the GitHub API using the collection's `path`
as a **repo-root-relative** path — the API has no notion of Vercel's
`root_directory = "app"` setting. But `createReader()` resolves `path`
relative to whatever directory you pass it, and Next.js server code's
`process.cwd()` is `app/` (both locally, since `npm run dev` runs from
`app/`, and on Vercel, since `root_directory = "app"`). If the reader were
called as `createReader(process.cwd(), config)`, a `path: 'content/blog/*'`
would read from `app/content/blog/` while GitHub-mode writes land at
`<repo-root>/content/blog/` — the admin UI would commit posts the site can
never see.

Fix: the reader is constructed as `createReader(path.join(process.cwd(), '..'), config)`
— one directory up from `app/`, i.e. the repo root — so both the writer
(GitHub API, repo-root-relative) and the reader (filesystem, now also
repo-root-relative) agree on `<repo-root>/content/blog/`. This is
deliberately a **different, sibling directory** to Phase 1's
`app/content/projects.ts` / `app/content/resume.ts`, which are plain
TypeScript files resolved by normal module imports (app-root-relative,
unrelated to Keystatic's GitHub-API path semantics) — not an
inconsistency, just two different mechanisms that happen to share the
word "content".

This resolution is reasoned from Keystatic's documented behavior, not
empirically verified against this exact repo layout (GitHub mode can't be
tested end-to-end until the human completes the manual GitHub App setup in
§3). The implementation task must verify it explicitly: place a fixture
`.mdx` file directly at `<repo-root>/content/blog/` and confirm the reader
finds it, in both `npm run dev` (from `app/`) and a production `npm run
build` (from `app/`, matching Vercel's `root_directory`).

## 5. Content schema

One Keystatic collection, `blog`, storage path `content/blog/*`,
`format: { contentField: 'content' }` (without this, the `content` field's
body is not written as the entry's markdown/MDX body — it's required for
the `.mdx` files this spec depends on):

| Field | Type | Notes |
|---|---|---|
| `title` | `fields.slug` | doubles as the slug source |
| `date` | `fields.date` | publish date, used for sort order |
| `summary` | `fields.text` | one-line description, shown in the list |
| `tags` | `fields.array` of `fields.text` | schema only — no filtering UI this phase |
| `content` | `fields.mdx` | post body |

**Reader API note:** the exact method names on `reader.collections.blog`
(`.all()` vs `.list()` + `.read()`/`.readOrThrow()`) and the exact shape of
a resolved `content` field (`entry.content()` returning `Promise<string>`
per available documentation) should be pinned against the actually-installed
`@keystatic/core` version's TypeScript types as the first implementation
step, not assumed from this spec — third-party library APIs drift faster
than this document.

**Branch behavior:** no `branchPrefix` restriction is configured. Keystatic
commits directly to this repo's actual default branch (`dev`, per
`CLAUDE.md`) — consistent with how everything else in this repo works, and
avoiding an unwanted branch-plus-PR-per-post workflow for a solo blog.

## 6. Auth

`/keystatic` (admin UI) and `/api/keystatic/*` (its API routes) are added
to the existing gated-path list in `app/lib/route-gate.ts` — same shared
password, same cookie, no new auth code. `/blog` and `/blog/[slug]` are
public, like the rest of the Phase-1 site.

**Login redirect fix (also this phase):** today, hitting a gated path while
unauthenticated always redirects to `/tools/bgm-looper/login`, and logging
in always sends you to `/tools/bgm-looper` regardless of where you started
— so visiting `/keystatic` while logged out would land you back on the
*tool*, not `/keystatic`, after logging in. Fix: the middleware's redirect
carries the original path as `?next=<path>`
(e.g. `/tools/bgm-looper/login?next=%2Fkeystatic`), the login page reads
`next` from `useSearchParams()`, and on success redirects there instead of
the hardcoded `/tools/bgm-looper` — falling back to `/tools/bgm-looper` if
`next` is missing or doesn't start with `/` (avoids an open-redirect via a
crafted `next` value).

**Caveat to verify during the manual setup (§3):** GitHub's OAuth-style
redirect back to `/api/keystatic/...` after authorizing the App is a
same-site top-level GET navigation, so the session cookie (`sameSite: "lax"`)
should be sent — but this is reasoned, not confirmed against Keystatic's
actual callback behavior. If step 3 in §3 fails with a `401
{"error":"unauthorized"}` JSON response instead of completing the GitHub
App flow, that's the symptom of this exact risk; the fix would be adding
the specific callback path to `ALWAYS_ALLOWED_PATHS` rather than the whole
`/api/keystatic/*` prefix.

## 7. Public pages

- `/blog`: a thin async Server Component reads all `blog` entries via the
  repo-rooted reader (§4), sorts by `date` descending, and passes the list
  to `BlogList` (presentational, sync) for rendering — title, date,
  summary, tags per entry, linking to `/blog/[slug]`.
- `/blog/[slug]`: a thin async Server Component reads one entry and passes
  its `title`/`date` and resolved MDX body to `PostBody` (presentational,
  sync) for rendering via `next-mdx-remote`. Exports `generateStaticParams`
  so posts prerender at build time — matches how Phase 1's five public
  pages are all statically generated (confirmed in that phase's review),
  and avoids a production-only failure mode where content outside the
  Next.js project root isn't available to a dynamically-rendered
  serverless function at request time.
- `SiteHeader`'s nav gains a `Blog` link, positioned between Resume and
  Contact.

## 8. Testing

- `SiteHeader.test.tsx` extended to assert the new `Blog` nav link and
  href.
- `BlogList` and `PostBody` are plain synchronous, props-based components
  — ordinary React Testing Library render tests, using fixture data (not a
  live Keystatic/GitHub read; tests must not depend on GitHub credentials
  existing in CI or on network access). This split is required, not just
  tidy: `/blog` and `/blog/[slug]`'s `page.tsx` files are `async` Server
  Components (they `await` the reader) and React Testing Library cannot
  render an async component directly — unlike every Phase-1 page, which
  was synchronous.
- The `page.tsx` wrappers themselves are not unit-tested (thin, no logic
  beyond read-then-pass-props) — covered instead by the build succeeding
  (which requires `generateStaticParams` and the reader to resolve
  correctly against real fixture content, per §4's verification step) and
  by manual QA after the human completes §3's GitHub App setup.
- No test attempts to exercise the Keystatic admin UI itself (`/keystatic`)
  — it's a third-party editor UI, not application logic this project
  owns; verifying it loads and is gated is a manual/smoke-test concern,
  not a unit-test one.
- `route-gate.test.ts` gets new cases for `/keystatic` and
  `/api/keystatic/*` (both gated), plus a case for the login page's `next`
  redirect handling.

## 9. Housekeeping (required, easy to forget)

- Verify `app/.gitignore` already covers `.env` before §3's manual setup
  generates real secrets into it — one grep, checked as part of
  implementation, before documenting the setup steps as safe.
- `CHANGELOG.md`'s `[Unreleased]` section gets an entry for this phase
  (blog added, `/keystatic` admin route) in the same PR — Phase 1's final
  review caught this being skipped once already; not repeating it.
- The 4 Keystatic env vars (§3) are added to Vercel **manually via its
  dashboard**, not through `infra/main/*.tf`'s `shared.tf` — deliberate:
  Terraform variables live in a gitignored `tfvars` file, but hand-entered
  Vercel dashboard secrets avoid a written-down copy anywhere in this
  repo's tracked files. This is intentional IaC drift for these 4 values
  specifically, not an oversight.

## 10. Out of scope (this phase)

- Tag filtering/search UI (schema exists, no UI built).
- RSS feed, comments.
- Newsletter (Phase 3 — separate spec, archive pages + external subscribe
  embed, per Phase 1's forward-looking note).
- Local-mode fallback for Keystatic — GitHub mode only, per §2.
