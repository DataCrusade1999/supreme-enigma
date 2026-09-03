# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions match the
git tags / GitHub Releases cut automatically by the `release` job in
`.github/workflows/deploy.yml` on every push to `main`.

## [Unreleased]

### Security

- Bumped the transitive `nanoid` (3.3.16 → 3.3.18, GHSA-2v37-7h3g-55p8) and
  `js-yaml` (4.3.0 → 4.3.2, GHSA-5p4m-2wfm-xmqj) in `app/package-lock.json`,
  clearing both open Dependabot alerts. Lockfile-only; neither was reachable
  with untrusted input (nanoid comes in via build-time postcss, js-yaml via
  eslint and Keystatic's parsing of repo-authored frontmatter).

### Added

- `.github/dependabot.yml` — weekly update checks for npm (`app/`), pip
  (`lambda/`), GitHub Actions, and Terraform (`infra/*`). PRs use a `chore`
  Conventional Commit prefix so the `release` job can still derive the
  version bump from them.

### Changed

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
