# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Structure

Three independent sibling projects, no monorepo tooling (no workspaces/Turborepo/Nx):
- `app/` — Next.js 15 + React 19 + TypeScript frontend, deployed to Vercel (`root_directory = "app"` — only changes here trigger a Vercel deploy).
- `lambda/` — Python 3.12 DSP pipeline (audio loop processing), packaged as a Lambda container image.
- `infra/bootstrap/` — Terraform, applied once manually, creates only the Terraform state S3 bucket. Never destroyed by the kill switch.
- `infra/main/` — Terraform, remote state, creates the audio S3 bucket, ECR repo, Lambda function, IAM users/roles, and Vercel project.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — the original design spec and TDD implementation plan this project was built from; check here for the "why" behind existing decisions before assuming something is undocumented.
- `.claude/worktrees/bgm-looper-impl/` is a stray leftover git worktree (untracked, a full duplicate checkout). Ignore it — don't search or edit inside it.

## Commands

- App tests: `cd app && npm test` (= `vitest run`).
- App lint: `cd app && npm run lint` (ESLint via `eslint-config-next`, config in `eslint.config.mjs`).
- App dev: `cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev`.
- Lambda tests: `cd lambda && pytest -v` (requires `pip install -r requirements.txt pytest moto`; `pytest.ini` sets `pythonpath = src`).
- Terraform: run from `infra/main/` with `-var-file=terraform.tfvars` (gitignored, contains `vercel_api_token`, `app_password`, `github_repo`).

## Branching & releases

- Three permanent branches: `dev` → `stage` → `main`. `dev` is the GitHub default branch — new local branches and PRs target `dev` by default. Promote by opening a PR `dev → stage`, then `stage → main` once QA'd.
- `main` is the only branch that deploys to AWS (Lambda/ECR) and cuts a release — see below. `dev`/`stage` still get automatic Vercel preview deployments (stable per-branch alias URLs) since the whole repo is connected, but they share the single AWS backend that `main`'s last CI run deployed — there's no per-branch Lambda.
- `vercel_project.looper` pins `git_repository.production_branch = "main"` explicitly in `vercel.tf`, decoupled from GitHub's default branch — required precisely because the default branch is `dev`, not `main`.
- Branch protection (PR-only merges, no force-push) on `stage`/`main` is **not enforced** — GitHub blocks branch protection/rulesets on private repos without Pro. Convention-only until upgraded or made public.
- `.github/workflows/deploy.yml`'s `release` job auto-tags and creates a GitHub Release (`gh release create --generate-notes`) on every successful push-triggered run on `main`. Version bump is derived from Conventional Commit prefixes since the last tag (`feat:` → minor, `!`/`BREAKING CHANGE:` → major, else patch) — not a hand-maintained changelog file, so promoting `dev`→`stage`→`main` never creates changelog merge conflicts.

## Gotchas

- **App env var is `APP_AWS_REGION`, not `AWS_REGION`** — deliberately named to avoid colliding with reserved AWS SDK/Vercel env vars.
- **`lambda.tf` has `lifecycle { ignore_changes = [image_uri] }`** — do not remove this. CI updates the deployed Lambda image via `aws lambda update-function-code`; Terraform intentionally doesn't manage `image_uri` after creation.
- **Terraform bootstrap order matters**: (1) apply `infra/bootstrap` once, (2) `terraform apply -target=aws_ecr_repository.looper` in `infra/main` (image must exist before the Lambda resource can be created), (3) apply IAM/exec-role resources, (4) push to `main` so CI builds+pushes the image, (5) final `terraform apply` creates the Lambda function + Vercel project.
- **Terraform AWS profile is pinned in the provider config** (`profile = "personal"`), not read from `AWS_PROFILE`. CI never sets this — it uses env-var credentials only.
- **`lambda/tests/conftest.py` sets dummy AWS creds at module import time**, not in a fixture — `handler.py` builds its boto3 client at module scope, so a fixture would set the env var too late.
- **`NUMBA_CACHE_DIR=/tmp/numba_cache`** is set in the Lambda Dockerfile — librosa's numba JIT cache otherwise tries to write to Lambda's read-only filesystem.
- **`vitest.config.ts` sets `passWithNoTests: true`** deliberately, and setup imports `@testing-library/jest-dom/vitest` (not the plain `jest-dom` entrypoint) — both are load-bearing, don't "clean up".
- Auth is a single shared password, not per-user: the session cookie payload is the literal string `"authenticated"` HMAC-signed with `COOKIE_SECRET`. There's no username or session ID.
- S3 objects: uploads under `uploads/`, processed output under `outputs/` (same key, prefix swapped), all auto-expire after 1 day. Presigned URLs expire after 300s.
