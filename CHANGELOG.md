# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions match the
git tags / GitHub Releases cut automatically by the `release` job in
`.github/workflows/deploy.yml` on every push to `main`.

## [Unreleased]

### Fixed

- `lambda/Dockerfile` now fetches ffmpeg with `curl -fL` instead of `curl -L`.
  Without `-f`, curl exits 0 on an HTTP error and writes the error page to
  `ffmpeg.tar.xz`, so the build failed a layer later with a misleading
  `xz: (stdin): File format not recognized` — as it did on the v1.2.0
  promotion. `-f` fails at the fetch with curl exit 22 and the real status
  code instead.

## [1.2.0] - 2026-09-04

### Security

- Bumped the transitive `nanoid` (3.3.16 → 3.3.18, GHSA-2v37-7h3g-55p8) and
  `js-yaml` (4.3.0 → 4.3.2, GHSA-5p4m-2wfm-xmqj) in `app/package-lock.json`,
  clearing both open Dependabot alerts. Lockfile-only; neither was reachable
  with untrusted input (nanoid comes in via build-time postcss, js-yaml via
  eslint and Keystatic's parsing of repo-authored frontmatter).

### Added

- Playwright end-to-end and accessibility test suite (`app/e2e/`) covering all
  seven public pages: page loads, header navigation, theme-toggle persistence,
  and an axe-core scan per page. Runs against a real Next.js server on port
  3100 via `npm run test:e2e`.
- Unit-test coverage for the two known gaps: `SiteFooter` and the blog list /
  post-detail pages.
- `app/TESTING.md` — testing conventions, including how to unit-test async
  server components and when to reach for e2e instead.
- `.github/scripts/test-summary.mjs` — parses both runners' JSON reports into
  a GitHub Actions job summary with pass/fail counts and collapsed failure
  details. The `test` job now runs Vitest and Playwright and reports both.
- `.github/dependabot.yml` — weekly update checks for npm (`app/`), pip
  (`lambda/`), GitHub Actions, and Terraform (`infra/*`). PRs use a `chore`
  Conventional Commit prefix so the `release` job can still derive the
  version bump from them.

### Changed

- CI `test` job now runs on Node 22 (was Node 20). Node 20 lacks
  `v8.markAsUncloneable` (added in 22.12), which undici 8's `CacheStorage`
  requires — pinning to 20 blocks the pending jsdom 30 bump, whose engines
  range starts at `^22.22.2`.

- Home page recomposed so the animated waveform clears the fold at 1440x900:
  the name and a new `FeaturedTool` block share one 12-column band (the h1
  drops from 148px to 104px), the figure moves directly beneath it, and the
  intro paragraph plus pipeline-settings table drop below it. The page's
  bottom "Open the tool" bar is gone — the featured-tool block now owns that
  call to action.

- Public portfolio redesigned as an editorial system: a warm paper ground and
  matching warm near-black dark mode, Instrument Serif + IBM Plex Sans loaded
  through `next/font/google` (self-hosted, no `fonts.googleapis.com` link), a
  visible 12-column grid with ruled rows instead of cards and terminal chrome,
  a shared bar envelope rendered both as the home page's waveform and as the
  About page's `LoopRing`, and a new `/projects/[slug]` detail page with an
  optional demo-GIF slot. Hover motion is gated with `motion-reduce:` and every
  looping animation has a `prefers-reduced-motion` off-switch.

- Portfolio accent swapped from the warm amber/VU-meter tone to a cool
  teal (`#187a73` light, `#5ec8c0` dark), with the secondary greys
  re-tinted to match. Includes the terminal chrome's own accent, which
  phase 2 had hardcoded to the old amber. All new pairs verified at WCAG
  AA (≥4.5:1) by a new `contrastRatio` utility and regression test.

- `README.md` reframed around the portfolio site rather than the BGM Looper
  tool: public pages first, the password-gated tools listed as a table, and
  architecture split into the site vs. the per-tool AWS backend.

### Fixed

- Line endings normalized to LF across the repo, pinned by a new
  `.gitattributes` — editors on Windows were writing CRLF back over blobs
  git stored as LF, so any touched file surfaced as a whole-file diff.
- `npm run lint` in `app/` restored: `typescript` pinned back from `^7.0.2` to
  `~5.9.3`. `typescript-eslint` (pulled in by `eslint-config-next`) declares
  `typescript: >=4.8.4 <6.1.0` and throws at ESLint config-load time on TS 7,
  so the command exited 2 without linting anything. Dependabot now ignores
  `typescript >=6` until typescript-eslint ships TS 7 support
  (typescript-eslint#10940). CI was unaffected — it runs no lint step and
  Next 16's `next build` no longer runs ESLint.

## [1.1.0] - 2026-08-01

### Added

- Public portfolio site: home, about, projects, resume, and contact pages,
  no login required.
- Dark/light theme toggle in the site header, dark by default, with the
  choice persisted in `localStorage`.
- Blog, powered by Keystatic (git-backed CMS). Admin UI at `/keystatic`
  (behind the existing password). Public posts at `/blog`.

### Changed

- The BGM Looper tool moved from `/` to `/tools/bgm-looper`, still behind
  the same password gate.

## [1.0.1] - 2026-07-31

### Changed

- CI actions bumped to node24-runtime versions (`actions/checkout` v7,
  `actions/setup-python` v7, `actions/setup-node` v7,
  `aws-actions/configure-aws-credentials` v6) — silences the "Node.js 20 is
  deprecated" warning GitHub Actions was printing on every run.

## [1.0.0] - 2026-07-31

### Added

- Initial release: single-user background-music looper — upload an audio
  file, get back a loudness-normalized, silence-trimmed, beat-aligned,
  crossfaded seamless loop. Next.js frontend on Vercel, Python DSP pipeline
  on a containerized AWS Lambda.
- Three-environment branch strategy: permanent `dev` → `stage` → `main`
  branches, each with its own Vercel deployment and its own AWS backend
  (Lambda + S3), promoted via PR.
- Shared ECR repo with per-branch image tag prefixes and independent
  lifecycle pruning, so one branch's image churn can't evict another's.
- Automatic GitHub Release + version tag on every push to `main`, versioned
  from Conventional Commit prefixes since the last tag.
