# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions match the
git tags / GitHub Releases cut automatically by the `release` job in
`.github/workflows/deploy.yml` on every push to `main`.

## [Unreleased]

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
