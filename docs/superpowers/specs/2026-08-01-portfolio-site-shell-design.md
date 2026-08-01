# Portfolio Site — Shell (Phase 1) — Design Spec

Date: 2026-08-01

## 1. Purpose

Turn this repo's single-purpose BGM Looper app into a personal portfolio
site, with the looper demoted to one gated tool inside it. Phase 1 ships a
complete, publicly-browsable site (home/about/projects/resume/contact) plus
the auth re-scope and the looper's relocation. Blog and newsletter are
separate follow-on phases (see §7) — not built here.

Budget constraint: total AWS spend must stay under 200 INR/month. Current
verified baseline (via `aws ce get-cost-and-usage --profile personal`,
account `223376380711`, last full month) is ~$0.075 (~6.25 INR) — almost
entirely ECR image storage, with S3/Lambda near zero because objects expire
in 1 day. This phase adds **zero new AWS resources** (portfolio pages are
static/Vercel-only), so the baseline is unaffected.

An EC2+Strapi CMS approach was evaluated and rejected: even the cheapest
viable instance (t3.nano, on-demand, us-east-1) costs ~$8.09/month
(compute $3.80 + mandatory public-IPv4 charge $3.65 + 8GB gp3 EBS $0.64) —
over 3x the entire budget, before a database for Strapi is even added. See
chat history for the priced comparison table. Decision: no self-hosted
server-backed CMS anywhere in this project.

## 2. Architecture

```
app/app/
  (site)/                  ← new route group, public, no auth gate
    page.tsx               ← home
    about/page.tsx
    projects/page.tsx
    resume/page.tsx
    contact/page.tsx
  tools/
    bgm-looper/
      page.tsx             ← current app/app/page.tsx, moved
      login/page.tsx       ← current app/app/login/page.tsx, moved
  api/
    looper/
      process/route.ts     ← renamed from api/process
      upload-url/route.ts  ← renamed from api/upload-url
    login/route.ts         ← unchanged path, still authenticates the tool
```

`app/lib/auth.ts` (cookie signing/verification) is unchanged — only what
gets gated changes, not how gating works.

## 3. Auth re-scope

Today (`app/middleware.ts`), the matcher is `((?!_next/static|_next/image|favicon.ico).*)`
— everything is gated except `/login` and `/api/login`. This phase narrows
it:

- Gated (cookie required): `/tools/bgm-looper/:path*`, `/api/looper/:path*`
- Always allowed, no cookie check: `/tools/bgm-looper/login`, `/api/login`
- Public, no auth code runs at all: everything else — `/`, `/about`,
  `/projects`, `/resume`, `/contact`

Failure-mode check: a matcher that's too broad silently re-gates the public
site; too narrow silently exposes the tool. Both directions get an explicit
test (§6).

## 4. Content model (phase 1 only)

No MDX/CMS yet — that's phase 2. Phase 1 content is plain typed data,
committed as code:

- `content/projects.ts` — array of project entries (name, description,
  link). Ships with exactly one entry: BGM Looper, linking to
  `/tools/bgm-looper`. Shaped so phase-2+ can add entries without a
  redesign.
- `content/resume.ts` — typed timeline entries (role, org, dates,
  bullets) rendered as an on-page timeline on `/resume`.
- `public/resume.pdf` — static file, linked as a download button on
  `/resume`.
- Contact page: static links only (mailto:, GitHub, LinkedIn, etc.) — no
  form, no backend, no new dependency.

## 5. Visual design

Dark-default technical aesthetic (monospace/code-inspired accents, fits
the audio/DSP nature of the looper) with a light-mode toggle. Actual
component-level design work (typography scale, color tokens, spacing,
component library choices) happens during implementation via the
`frontend-design` skill — not decided in this spec.

## 6. Testing

- Vitest table test over the middleware's routing logic: given a path,
  assert gated vs. public (covers both failure directions from §3).
- Existing looper tests (`app/app/page.test.tsx` etc.) move with the code,
  otherwise unchanged.
- Resume/projects data render tests (basic — the page renders the
  expected number of entries).
- No new AWS/infra tests: phase 1 touches no AWS resources.

## 7. Out of scope (future phases, separate specs)

- **Phase 2 — Blog**: Keystatic admin UI (git-backed, commits MDX to the
  repo via GitHub API in prod, local FS in dev) mounted at `/keystatic`.
  `content/blog/*.mdx` collection, rendered via static generation. $0
  hosting — no DB, no server.
- **Phase 3 — Newsletter**: archive pages (`content/newsletter/*.mdx`,
  same pattern as blog) plus a subscribe embed via an external free-tier
  service (e.g. Buttondown) — sending/deliverability handled off-site,
  $0 AWS cost.
- Custom domain: explicitly declined for now: staying on the free
  `*.vercel.app` subdomain.
- Contact form: explicitly declined for now: static links only.
