# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions match the
git tags / GitHub Releases cut automatically by the `release` job in
`.github/workflows/deploy.yml` on every push to `main`.

## [Unreleased]

### Added

- The ⌘K/Ctrl+K command bar now works on the `/login` gate, which renders its
  own `<CommandBar />` — it sits outside the `(site)` route group, so it didn't
  inherit one, and with no SiteHeader the shortcut is the only nav there besides
  the wordmark. The global handler's "don't hijack a focused form field" guard
  now exempts password inputs, so the shortcut works from the gate's password
  box too; every other field type still suppresses it. Gated pages behind the
  login still get no command bar.

### Fixed

- The login page's "Continuing to → X" strip no longer disappears when `?next`
  carries a query or hash directly after a tool prefix (`/keystatic?path=posts`,
  `/tools/bgm-looper#top`). `parseNext` was handing the whole
  `pathname + search + hash` string to `toolNameFor`, whose prefix match needs a
  `/` boundary; it now returns the pathname and the full target separately, so
  the strip matches on the former while the post-login redirect still carries
  the latter. Display-only — the redirect itself was always correct, and
  `proxy.ts` only ever sets `next` to a bare pathname, so it took a hand-written
  URL to hit.

### Changed

- The login page moved from `/tools/bgm-looper/login` to `/login` and is now a
  general gate for every tool on the site rather than the looper's own. It is
  designed in the portfolio's editorial system (Instrument Serif masthead over
  a 2px rule, the twelve-column hairline backdrop, the LoopRing as the site's
  mark) instead of being unstyled, and names the tool the visitor was heading
  to — resolved from `?next` through a new `toolNameFor()` in
  `app/lib/route-gate.ts`, which renders nothing for a destination it doesn't
  recognise rather than printing a raw path back. Stale links to the old path
  now redirect through the gate and land on the tool after signing in.

- CI `test` job now runs `npm run lint` alongside the Vitest and Playwright
  suites, and fails the job if lint fails. Lint was previously outside the CI
  gate entirely, so a dependency bump that broke the lint toolchain showed all
  checks green — as the ESLint 10 bump did (#68, tracked in #79). Lint runs
  before the test suites but only reports its exit code, so a lint error no
  longer hides the test results.
- Vercel Authentication is now disabled for preview deployments
  (`vercel_authentication = { deployment_type = "none" }`), making the `dev` and
  `stage` URLs publicly reachable. The AWS DevOps Agent's UI release testing
  cannot use a protection bypass token — it navigates to sub-paths directly, so
  the token in the test profile's query string is never carried over, and plan
  generation truncates it when the agent tries to re-add it. `APP_PASSWORD` still
  gates `/tools/bgm-looper`, `/api/looper` and `/keystatic` independently.

### Added

- `.github/workflows/release-tests.yml` — manual-dispatch workflow that runs the
  AWS DevOps Agent's UI release testing against the `stage` deployment and
  reports the verdict as a GitHub Check Run. Needs the `DEVOPS_AGENT_WEBHOOK_URL`
  / `DEVOPS_AGENT_WEBHOOK_SECRET` repo secrets and the
  `DEVOPS_AGENT_TEST_PROFILE_ID` repo variable; setup and gotchas are in
  `docs/aws-devops-agent.md`.
- Vercel automation bypass token (`vercel_project_protection_bypass.automation`
  in `infra/main/shared.tf`) so the AWS DevOps Agent's release testing can reach
  the `stage` preview URL. Preview deployments stay behind Vercel
  Authentication; the agent's test profile URL carries
  `?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`
  instead. Read the secret with `terraform output -raw
  protection_bypass_secret`.

### Fixed

- `lambda/Dockerfile` now fetches ffmpeg with `curl -fL` instead of `curl -L`.
  Without `-f`, curl exits 0 on an HTTP error and writes the error page to
  `ffmpeg.tar.xz`, so the build failed a layer later with a misleading
  `xz: (stdin): File format not recognized` — as it did on the v1.2.0
  promotion. `-f` fails at the fetch with curl exit 22 and the real status
  code instead. The same fetch now also retries with `--retry 3
  --retry-delay 5`, so a transient `johnvansickle.com` blip (connection
  timeout or 5xx — the failure mode that has broken `deploy` twice) is
  ridden out in-build rather than needing a `workflow_dispatch` rerun. A
  permanent error such as a 404 still fails on the first attempt.

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
