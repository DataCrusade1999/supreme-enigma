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

1. Pull the branch locally, run `npm run dev`.
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
        page.tsx               ← post list
        [slug]/page.tsx         ← single post
content/
  blog/                     ← Keystatic-managed .mdx files land here
```

New npm dependencies: `@keystatic/core`, `@keystatic/next`, `@markdoc/markdoc`
(Keystatic's own peer dependency), `next-mdx-remote` (renders the `fields.mdx()`
body — Keystatic stores MDX content but deliberately leaves rendering to the
consuming app).

## 5. Content schema

One Keystatic collection, `blog`, storage path `content/blog/*`:

| Field | Type | Notes |
|---|---|---|
| `title` | `fields.slug` | doubles as the slug source |
| `date` | `fields.date` | publish date, used for sort order |
| `summary` | `fields.text` | one-line description, shown in the list |
| `tags` | `fields.array` of `fields.text` | schema only — no filtering UI this phase |
| `content` | `fields.mdx` | post body |

## 6. Auth

`/keystatic` (admin UI) and `/api/keystatic/*` (its API routes) are added
to the existing gated-path list in `app/lib/route-gate.ts` — same shared
password, same cookie, no new auth code. `/blog` and `/blog/[slug]` are
public, like the rest of the Phase-1 site.

## 7. Public pages

- `/blog`: reads all `blog` entries via `createReader()` from
  `@keystatic/core/reader`, sorted by `date` descending. Renders title,
  date, summary, and tags for each, linking to `/blog/[slug]`.
- `/blog/[slug]`: reads one entry, renders its `title`/`date` and the
  `content` field's MDX body via `next-mdx-remote`.
- `SiteHeader`'s nav gains a `Blog` link, positioned between Resume and
  Contact.

## 8. Testing

- `SiteHeader.test.tsx` extended to assert the new `Blog` nav link and
  href.
- `/blog` and `/blog/[slug]` page tests use fixture/mock content (not a
  live Keystatic/GitHub read) — tests must not depend on GitHub
  credentials existing in CI or on network access.
- No test attempts to exercise the Keystatic admin UI itself (`/keystatic`)
  — it's a third-party editor UI, not application logic this project
  owns; verifying it loads and is gated is a manual/smoke-test concern,
  not a unit-test one.
- `route-gate.test.ts` gets new cases for `/keystatic` and
  `/api/keystatic/*` (both gated).

## 9. Out of scope (this phase)

- Tag filtering/search UI (schema exists, no UI built).
- RSS feed, comments.
- Newsletter (Phase 3 — separate spec, archive pages + external subscribe
  embed, per Phase 1's forward-looking note).
- Local-mode fallback for Keystatic — GitHub mode only, per §2.
