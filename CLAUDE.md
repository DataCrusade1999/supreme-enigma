# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Structure

Three independent sibling projects, no monorepo tooling (no workspaces/Turborepo/Nx):
- `app/` — Next.js 15 + React 19 + TypeScript frontend, deployed to Vercel (`root_directory = "app"` — only changes here trigger a Vercel deploy). Public portfolio pages (home/about/projects/resume/contact) live in the `app/app/(site)/` route group; the BGM Looper tool itself lives at `app/app/tools/bgm-looper/` and is the only gated part of the site — see `app/lib/route-gate.ts`.
- `lambda/` — Python 3.12 DSP pipeline (audio loop processing), packaged as a Lambda container image.
- `infra/bootstrap/` — Terraform, applied once manually, creates only the Terraform state S3 bucket. Never destroyed by the kill switch.
- `infra/main/` — Terraform, remote state, creates the audio S3 bucket, ECR repo, Lambda function, IAM users/roles, and Vercel project.
- `content/` — repo root, sibling to `app/`: git-backed blog content managed by Keystatic (GitHub mode), separate from the hand-written `app/content/projects.ts`/`resume.ts` data files — see `docs/superpowers/specs/2026-08-01-portfolio-blog-design.md` for why.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — the design specs and TDD implementation plans this project was built from (one pair per phase: the original bgm-looper build, the portfolio-site restructuring, the blog, etc.); check here for the "why" behind existing decisions before assuming something is undocumented.
- `.claude/worktrees/bgm-looper-impl/` is a stray leftover git worktree (untracked, a full duplicate checkout). Ignore it — don't search or edit inside it.

## Commands

- App tests: `cd app && npm test` (= `vitest run`).
- App lint: `cd app && npm run lint` (ESLint via `eslint-config-next`, config in `eslint.config.mjs`).
- App dev: `cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev`.
- Lambda tests: `cd lambda && pytest -v` (requires `pip install -r requirements.txt pytest moto`; `pytest.ini` sets `pythonpath = src`).
- Terraform: run from `infra/main/` with `-var-file=terraform.tfvars` (gitignored, contains `vercel_api_token`, `app_password`, `github_repo`).

## Branching & releases

- Three permanent branches: `dev` → `stage` → `main`. `dev` is the GitHub default branch — new local branches and PRs target `dev` by default. Promote by opening a PR `dev → stage`, then `stage → main` once QA'd.
- Live URLs (see README's Environments table too): `main` → https://bgm-looper.vercel.app, `stage` → https://bgm-looper-git-stage-ashutosh-pandeys-projects-77cb3a00.vercel.app, `dev` → https://bgm-looper-git-dev-ashutosh-pandeys-projects-77cb3a00.vercel.app.
- `infra/main/*.tf` is split by shared-vs-per-branch, not by resource type: `shared.tf` holds the one-of-each resources used by all three branches (ECR repo, IAM exec role + service-account users, the Vercel project, env-agnostic secrets) — `environments.tf` holds the per-branch resources (each branch's S3 bucket, Lambda function, and the Vercel env var overrides that point at them).
- Each branch has its own full backend: separate Lambda functions (`bgm-looper-processor`, `-dev`, `-stage`), separate S3 buckets (`bgm-looper-audio-<account>`, `-dev-<account>`, `-stage-<account>`), one shared ECR repo with per-branch tag prefixes (`main-<sha>`, `dev-<sha>`, `stage-<sha>`; only `main` also gets `:latest`). `main`'s Lambda/bucket are the original resources (unrenamed, to avoid a destructive rename) — `dev`/`stage` are the `_env` for_each twins in `environments.tf`. All three share one IAM exec role, scoped to all three bucket ARNs.
- Vercel picks the right `S3_BUCKET_NAME`/`LAMBDA_FUNCTION_NAME` per branch via `git_branch`-scoped env var overrides in `environments.tf`: `production` target → main's resources, bare `preview` target (the default for any branch) → dev's resources, `git_branch = "stage"` override → stage's resources.
- ECR's lifecycle policy prunes each prefix independently (keep last 5 per `main`/`dev`/`stage`) — a burst of `dev` pushes can't evict images `main` still needs.
- `vercel_project.looper` pins `git_repository.production_branch = "main"` explicitly in `shared.tf`, decoupled from GitHub's default branch — required precisely because the default branch is `dev`, not `main`.
- Branch protection (PR-only merges, no force-push) on `stage`/`main` is **not enforced** — GitHub blocks branch protection/rulesets on private repos without Pro. Convention-only until upgraded or made public.
- `.github/workflows/deploy.yml`'s `release` job auto-tags and creates a GitHub Release (`gh release create --generate-notes`) on every successful push-triggered run on `main`. Version bump is derived from Conventional Commit prefixes since the last tag (`feat:` → minor, `!`/`BREAKING CHANGE:` → major, else patch).
- `CHANGELOG.md` (Keep a Changelog format): add entries under `## [Unreleased]` by hand, in the same PR as the change — that part is still manual. The release-time bookkeeping is automated: the `release` job renames `[Unreleased]` to the new version + today's date and commits that to `main` *before* creating the tag (so the tag lands on the commit that has the matching heading), then opens a `chore/changelog-sync-vX.Y.Z` PR against `dev` cherry-picking that exact commit — merge it to keep all three branches' `CHANGELOG.md` identical. That two-step (commit on `main`, then a separate PR into `dev`) is deliberate: a plain main-only commit would permanently diverge and conflict on every future `dev → stage → main` promotion (the same reason `release-please` was ruled out earlier) — routing the same change through an explicit PR avoids that. Bot-opened PRs don't trigger the `test` workflow (GitHub suppresses that for the default `GITHUB_TOKEN`, to prevent recursive triggering) — no checks showing up on that PR is expected, not broken.

## Gotchas

- **App env var is `APP_AWS_REGION`, not `AWS_REGION`** — deliberately named to avoid colliding with reserved AWS SDK/Vercel env vars.
- **`lambda.tf` has `lifecycle { ignore_changes = [image_uri] }`** — do not remove this. CI updates the deployed Lambda image via `aws lambda update-function-code`; Terraform intentionally doesn't manage `image_uri` after creation.
- **Terraform bootstrap order matters**: (1) apply `infra/bootstrap` once, (2) `terraform apply -target=aws_ecr_repository.looper` in `infra/main` (image must exist before the Lambda resource can be created), (3) apply IAM/exec-role resources, (4) push to `main` so CI builds+pushes the image, (5) final `terraform apply` creates the Lambda function + Vercel project.
- **Terraform AWS profile is pinned in the provider config** (`profile = "personal"`), not read from `AWS_PROFILE`. CI never sets this — it uses env-var credentials only.
- **Always use `--profile personal` for any manual `aws` CLI command in this project.** It's a different AWS account (`223376380711`) than whatever the shell's default/`admin` profile points to (`688799538039`, unrelated account with no CE/Pricing/S3-list access) — this repo's actual infra (S3 buckets, ECR repo, Lambda) lives under `personal`.
- **`lambda/tests/conftest.py` sets dummy AWS creds at module import time**, not in a fixture — `handler.py` builds its boto3 client at module scope, so a fixture would set the env var too late.
- **`NUMBA_CACHE_DIR=/tmp/numba_cache`** is set in the Lambda Dockerfile — librosa's numba JIT cache otherwise tries to write to Lambda's read-only filesystem.
- **`vitest.config.ts` sets `passWithNoTests: true`** deliberately, and setup imports `@testing-library/jest-dom/vitest` (not the plain `jest-dom` entrypoint) — both are load-bearing, don't "clean up".
- Auth is a single shared password, not per-user: the session cookie payload is the literal string `"authenticated"` HMAC-signed with `COOKIE_SECRET`. There's no username or session ID.
- Only `/tools/bgm-looper`, `/api/looper/*`, `/keystatic`, and `/api/keystatic/*` require the shared password — `app/lib/route-gate.ts`'s `isGatedPath()` is the single source of truth for what's gated; the public portfolio pages have no auth check at all. The tool's API routes were renamed from `/api/upload-url`/`/api/process` to `/api/looper/upload-url`/`/api/looper/process` to share one gated prefix with the page.
- **Styling is Tailwind CSS v4**, configured CSS-first in `app/app/globals.css` (no `tailwind.config.js`) — theme tokens (`--color-bg`, `--color-fg`, `--color-accent`, etc.) are declared once in a light `@theme` block and overridden in `:root.dark`, deliberately in both places so neither mode silently falls back to the other's value. Dark is the default; the toggle persists to `localStorage` and is applied pre-hydration by an inline script to avoid a flash.
- S3 objects: uploads under `uploads/`, processed output under `outputs/` (same key, prefix swapped), all auto-expire after 1 day. Presigned URLs expire after 300s.
