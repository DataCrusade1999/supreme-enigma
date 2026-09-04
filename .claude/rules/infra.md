---
paths:
  - infra/**
---

# `infra/` — Terraform

Command and the per-branch resource layout live in the root `CLAUDE.md` (Commands, Branching & releases). This file is the per-file detail.

- **All three Lambda resources in `environments.tf` have `lifecycle { ignore_changes = [image_uri] }`** — do not remove this. CI updates the deployed Lambda image via `aws lambda update-function-code`; Terraform intentionally doesn't manage `image_uri` after creation.
- **Bootstrap order matters**: (1) apply `infra/bootstrap` once, (2) `terraform apply -target=aws_ecr_repository.looper` in `infra/main` (image must exist before the Lambda resource can be created), (3) apply IAM/exec-role resources, (4) push to `main`/`dev`/`stage` so CI builds+pushes each branch's image, (5) final `terraform apply` creates the Lambda functions + Vercel project. Step 5's `image_uri` for each function is a fixed tag from `var.bootstrap_image_tag_main`/`_dev`/`_stage` in `variables.tf` (defaults point at whatever tags were live as of 2026-08-06) — **before a from-scratch recreate** (e.g. after the kill-switch `terraform destroy`), update these to tags that branch's CI has actually pushed (`aws ecr describe-images --repository-name bgm-looper-lambda --profile personal --region us-east-1`). Because of the `ignore_changes` above, these vars are only consulted at creation time — deliberately a fixed tag per branch rather than a dynamic "most recently pushed" lookup, since the latter isn't branch-aware (could bootstrap `main`'s Lambda with a `dev` image) and forces every `terraform plan` to read ECR even when unrelated to Lambda, hard-failing if the repo is ever empty.
- **Terraform never reads `AWS_PROFILE`**: `providers.tf` sets `profile = var.aws_profile` (default `"personal"`) and `backend.tf` hardcodes the literal `"personal"`. CI sets neither — it uses env-var credentials only.
- **The three `KEYSTATIC_*` Vercel env vars are not managed here** (`grep KEYSTATIC infra/main/*.tf` is empty) — unlike every other Vercel env var in this project they were set by hand in the Vercel dashboard, so a from-scratch recreate produces a Vercel project whose builds fail until they're re-added manually.
- **A green CI `test` says nothing about `infra/`** — there is no `validate`, `fmt -check`, or `plan` anywhere in `deploy.yml`. For any PR touching `infra/`, run `terraform plan` in a scratch worktree against real state before merging and confirm `No changes.`
