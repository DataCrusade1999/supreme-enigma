# Ashutosh Pandey — portfolio & personal tools

A personal portfolio site with a small workshop of private tools attached.
The portfolio half (home, about, projects, resume, blog, contact) is public
and needs no login. The tools half sits behind a single shared password —
these are things built for one user, not a product with accounts.

Live at **https://bgm-looper.vercel.app** (the domain still carries the name
of the first tool that lived here).

## What's on the site

**Public — no login**

| Path | What it is |
|---|---|
| `/` | Landing page |
| `/about` | About |
| `/projects` | Project index |
| `/resume` | Resume |
| `/blog`, `/blog/[slug]` | MDX blog posts, stored in `content/blog/` |
| `/contact` | Contact |

Press <kbd>⌘K</kbd> / <kbd>Ctrl-K</kbd> anywhere on the public site for a
terminal-style command bar (`cd about`, `open bgm-looper`, `theme dark`, …).

**Password-gated**

| Path | Tool | Status |
|---|---|---|
| `/tools/bgm-looper` | **BGM Looper** — upload a background-music track, get back a seamlessly looping version: silence trimmed, loudness-normalized, beat-aligned loop point, equal-power crossfaded seam. Output keeps the input's format. | Live |
| `/keystatic` | **Blog CMS** — [Keystatic](https://keystatic.com) in GitHub mode, editing `content/blog/*.mdx` by committing to this repo. | Live |
| — | **BGM Extractor** — Demucs voice/music separation. Design spec and build plan approved; no code or infra yet (IAM policies already widened for it). | Specced |
| — | **PDF Restorer** — see `docs/superpowers/specs/2026-08-13-pdf-restorer-design.md`. | Specced |

## Architecture

Two layers that barely touch each other: a mostly-static site, and per-tool
compute in AWS that only the gated routes reach.

```
Browser
  │
  ▼
Vercel — Next.js 16 / React 19 (root_directory = "app")
  │  proxy.ts gates /tools/bgm-looper, /api/looper/*, /keystatic, /api/keystatic/*
  │  public portfolio pages: no auth, no backend
  │
  ├─ POST /api/looper/upload-url → presigned S3 PUT URL
  ├─ browser PUTs the file straight to S3 (Vercel never sees audio bytes)
  ├─ POST /api/looper/process    → synchronous Lambda invoke, ~10–20s
  └─ presigned S3 GET URL back   → in-page loop preview + download
  │
  ▼
AWS — Lambda + S3, personal account, us-east-1, all Terraform-managed
```

**The site.** Next.js App Router. Public pages live in the `app/(site)/`
route group; the tools live outside it under `app/tools/`, so they don't
inherit the site header or command bar. Styling is Tailwind CSS v4,
configured CSS-first in `app/app/globals.css` (no `tailwind.config.js`) —
dark by default, with the theme applied pre-hydration to avoid a flash.
Portfolio content is hand-written data (`app/content/projects.ts`,
`resume.ts`); blog posts are MDX in the repo-root `content/` directory,
git-backed and edited through Keystatic.

**The gate.** One shared password (a Vercel env var) checked with a
constant-time compare in `/api/login`, exchanged for an HMAC-signed HttpOnly
cookie. No accounts, no per-user state, no session store.
`app/lib/route-gate.ts`'s `isGatedPath()` is the single source of truth for
what's protected — adding a new tool means adding its prefix there and
nothing else.

**The tools' backend.** BGM Looper's DSP pipeline (silence trim → loudness
normalize to −14 LUFS → beat-aligned loop-point search → equal-power
crossfade → ffmpeg transcode) runs as a containerized Python 3.12 Lambda,
1024MB / 60s. Audio moves browser↔S3 directly via presigned URLs; the Vercel
API routes only orchestrate. S3 objects expire after 1 day.

**Infrastructure.** The whole stack (S3, ECR, Lambda, IAM, the Vercel
project itself) is Terraform. `terraform destroy` in `infra/main/` is the
kill switch: one command removes everything that can incur AWS cost.

Full rationale and trade-offs live in `docs/superpowers/specs/` — one design
spec and implementation plan per phase of this project.

## Environments

Three permanent branches, each with its own Vercel deployment and its own
isolated AWS backend (separate Lambda + S3 bucket, shared ECR repo with
per-branch tag prefixes). See "Branching & releases" in `CLAUDE.md` for how
promotion works.

| Branch  | URL | Purpose |
|---------|-----|---------|
| `main`  | https://bgm-looper.vercel.app | Production |
| `stage` | https://bgm-looper-git-stage-ashutosh-pandeys-projects-77cb3a00.vercel.app | Pre-prod QA |
| `dev`   | https://bgm-looper-git-dev-ashutosh-pandeys-projects-77cb3a00.vercel.app | Default branch, integration |

Promote by PR: `dev` → `stage` → `main`.

## Repo layout

```
app/        Next.js app (TypeScript)
  app/(site)/     public portfolio pages
  app/tools/      password-gated tools
  app/api/        login, per-tool API routes, Keystatic
  components/     site chrome (header, footer, command bar, theme toggle)
  content/        hand-written projects + resume data
  lib/            auth, route gate, AWS helpers, blog reader
content/    Blog posts (MDX), managed by Keystatic in GitHub mode
lambda/     Python DSP pipeline + Lambda handler + Dockerfile
infra/
  bootstrap/  Terraform, applied once by hand — creates the TF state bucket
              only. Deliberately outside the kill switch.
  main/       Terraform, remote state — S3, ECR, Lambda, IAM, Vercel project.
              `terraform destroy` here removes the entire application.
docs/superpowers/specs/   Design specs, one per phase
docs/superpowers/plans/   TDD implementation plans, checkbox-tracked
.github/workflows/        CI/CD — tests, per-branch Lambda image build/push,
                          and (main only) tag + GitHub Release
```

## Local development

```bash
# Next.js app
cd app
npm install
npm test                                              # vitest
npm run lint
APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev

# Lambda DSP pipeline (into a local venv, to leave the global interpreter alone)
cd lambda
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt pytest moto   # Windows
# .venv/bin/python -m pip install -r requirements.txt pytest moto     # macOS/Linux
.venv/Scripts/python -m pytest -q
```

Re-run that `pip install` whenever a dependency bump to `lambda/requirements.txt`
lands — the venv doesn't refresh itself.

Needs Node 20+, Python 3.12, and ffmpeg on PATH for the Lambda pipeline.
The public site runs without any AWS credentials; only the BGM Looper tool
needs them.

## Infrastructure setup

Requires Terraform ≥1.10, an AWS account, a Vercel account + API token, and
a gitignored `infra/main/terraform.tfvars` holding `vercel_api_token`,
`app_password`, and `github_repo`. The Lambda container image is built and
pushed by GitHub Actions, never locally, so bootstrap order matters:

1. **State bucket** (one-time, manual):
   ```bash
   cd infra/bootstrap
   terraform init && terraform apply
   ```
   The `state_bucket_name` output is hardcoded into `infra/main/backend.tf`.

2. **ECR repo only** — the Lambda resource can't be created before an image
   exists:
   ```bash
   cd infra/main
   terraform init
   terraform apply -target=aws_ecr_repository.looper -var-file=terraform.tfvars
   ```

3. **Lambda execution role + IAM users**:
   ```bash
   terraform apply -var-file=terraform.tfvars
   ```
   Copy `ci_deploy_access_key_id` / `ci_deploy_secret_access_key` from
   `terraform output` into the GitHub secrets `AWS_CI_ACCESS_KEY_ID` /
   `AWS_CI_SECRET_ACCESS_KEY`.

4. **Push to `main`/`dev`/`stage`** — CI tests, then builds and pushes each
   branch's Lambda image to ECR.

5. **Apply the rest** — Lambda functions and the Vercel project, now that
   the images exist:
   ```bash
   terraform apply -var-file=terraform.tfvars
   ```
   Vercel's git integration (created by this apply) deploys the app on every
   push from then on, independently of GitHub Actions.

Before a from-scratch recreate, update `bootstrap_image_tag_main`/`_dev`/
`_stage` in `variables.tf` to tags CI has actually pushed — see the Gotchas
section of `CLAUDE.md`.

## Tearing everything down (kill switch)

```bash
cd infra/main
terraform destroy -var-file=terraform.tfvars
```

Removes the Vercel project, all three Lambdas, the ECR repo, the S3 audio
buckets, and the IAM resources — including the `ci-deploy` user, so
re-applying afterward means refreshing the `AWS_CI_*` GitHub secrets before
CI can deploy again. The Terraform state bucket in `infra/bootstrap` is left
alone: it holds no app data and costs nothing meaningful.

## Cost

Roughly **$1–2 / month**, dominated by ECR image storage. Lambda and S3 sit
comfortably inside the free tier at single-user volume — no always-on
compute, no database, no queue. Measured numbers and the breakdown are in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Project management

Work is tracked as GitHub issues on the
[BGM Looper Roadmap](https://github.com/users/DataCrusade1999/projects/4)
board, labeled by `area:` and `priority:`. See `CLAUDE.md` for conventions.

## Changelog & License

See [CHANGELOG.md](CHANGELOG.md) for release history and [LICENSE](LICENSE) (MIT).
