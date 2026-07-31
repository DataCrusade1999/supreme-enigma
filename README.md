# BGM Looper

Single-user web app: upload a background-music audio file, get back an
edited version that loops seamlessly — loudness-normalized, silence-trimmed,
beat-aligned loop point, crossfaded seam. Output keeps the input's original
format.

**Status:** implemented and deployed. All app/Lambda/infra code is on `main`,
CI is green, and the app is live on Vercel backed by real AWS infra
(account `223376380711`, `us-east-1`) — verified end-to-end with a real
audio upload. Only the final kill-switch (`terraform destroy`) verification
is outstanding.
See `docs/superpowers/specs/2026-07-27-bgm-looper-design.md` (design) and
`docs/superpowers/plans/2026-07-27-bgm-looper-plan.md` (task-by-task build plan, 20 tasks).

## Architecture

```
Browser → Vercel (Next.js, thin API) → AWS (Lambda + S3, personal account)
```

- Browser uploads/downloads audio **directly to/from S3** via presigned URLs.
  Vercel never touches raw audio bytes.
- Vercel API routes just orchestrate: get a presigned upload URL, invoke the
  Lambda synchronously, return a presigned download URL.
- The DSP pipeline (loudness normalize → silence trim → beat-aligned
  loop-point search → crossfade → ffmpeg transcode) runs as a containerized
  Python Lambda.
- Single shared password + signed cookie for auth — no user accounts.
- Entire stack (S3, Lambda, ECR, IAM, Vercel project) is provisioned by
  Terraform. `terraform destroy` is the kill switch: one command tears down
  everything that can incur AWS cost or that constitutes "the app."
- GitHub Actions runs tests on every push and PR, and on push to `main`,
  `stage`, or `dev` builds that branch's Lambda container image, pushes it
  to ECR under a branch-prefixed tag, and updates that branch's own Lambda
  function. Vercel's own git integration deploys the app for each branch
  independently of GitHub Actions — see Environments below.

Full rationale and trade-offs: `docs/superpowers/specs/2026-07-27-bgm-looper-design.md`.

## Environments

Three permanent branches, each with its own Vercel deployment and its own AWS backend (Lambda + S3) — see "Branching & releases" in `CLAUDE.md` for how promotion and backend isolation work.

| Branch  | URL | Purpose |
|---------|-----|---------|
| `main`  | https://bgm-looper.vercel.app | Production — the live app |
| `stage` | https://bgm-looper-git-stage-ashutosh-pandeys-projects-77cb3a00.vercel.app | Pre-prod QA |
| `dev`   | https://bgm-looper-git-dev-ashutosh-pandeys-projects-77cb3a00.vercel.app | Default branch, integration |

## Repo layout

```
app/      Next.js app (TypeScript) — UI, auth, API routes
lambda/   Python DSP pipeline + Lambda handler + Dockerfile
infra/
  bootstrap/  Terraform, applied once manually — creates the TF state bucket only.
              Not part of the kill switch (holds no app data, negligible cost).
  main/       Terraform, remote state — S3, ECR, Lambda, IAM, Vercel project.
              `terraform destroy` here removes the entire application.
docs/superpowers/specs/   Design spec
docs/superpowers/plans/   Implementation plan (20 tasks, TDD, checkbox-tracked)
.github/workflows/        CI/CD: test (Lambda pytest + app vitest), build/push Lambda image to
                          ECR per branch, and (main only) tag + publish a GitHub Release
```

## Prerequisites

- Node.js 20+, Python 3.12, Terraform ≥1.10 (Docker only needed if testing
  the Lambda container image locally)
- An AWS account with credentials configured for two IAM principals: your
  own admin/deploy credentials (for running Terraform) and, later, the
  `ci-deploy` IAM user Terraform creates (for GitHub Actions)
- A Vercel account + API token
- ffmpeg on PATH (for running the Lambda pipeline locally)
- A `terraform.tfvars` in `infra/main/` (gitignored) with real
  `vercel_api_token`, `app_password`, and `github_repo` values

## Setup

The Lambda container image is built and pushed by GitHub Actions
(`.github/workflows/deploy.yml`), not locally — this repo's Terraform and CI
were bootstrapped in this order:

1. **Bootstrap the Terraform state bucket** (one-time, manual):
   ```bash
   cd infra/bootstrap
   terraform init && terraform apply
   ```
   Note the `state_bucket_name` output — it's hardcoded into `infra/main/backend.tf`.

2. **Apply the ECR repo only** (the image doesn't exist yet, so the Lambda
   function resource can't be created before this):
   ```bash
   cd infra/main
   terraform init
   terraform apply -target=aws_ecr_repository.looper -var-file=terraform.tfvars
   ```

3. **Apply the Lambda execution role + IAM users** (Vercel service account
   and CI deploy user):
   ```bash
   terraform apply -var-file=terraform.tfvars
   ```
   Copy `ci_deploy_access_key_id` / `ci_deploy_secret_access_key` from
   `terraform output` into the GitHub repo secrets
   `AWS_CI_ACCESS_KEY_ID` / `AWS_CI_SECRET_ACCESS_KEY`.

4. **Push to `main`** — GitHub Actions runs tests, then builds and pushes
   the Lambda image to ECR.

5. **Apply the rest** (Lambda function resource + Vercel project/env vars,
   now that the image exists):
   ```bash
   terraform apply -var-file=terraform.tfvars
   ```
   Vercel's git integration (created by this apply) then deploys the app on
   every future push to `main`, independently of GitHub Actions.

Full step-by-step with exact Terraform files: `docs/superpowers/plans/2026-07-27-bgm-looper-plan.md`, Tasks 9–15 and 20.

## Local development

```bash
# Lambda pipeline
cd lambda
pip install -r requirements.txt pytest moto
pytest

# Next.js app
cd app
npm install
npm test
APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev
```

## Tearing everything down (kill switch)

```bash
cd infra/main
terraform destroy -var-file=terraform.tfvars
```

Removes the Vercel project, Lambda, ECR repo, S3 audio bucket, and IAM
resources (including the `ci-deploy` user — re-applying afterward requires
refreshing the `AWS_CI_*` GitHub secrets before CI can deploy again). The
Terraform state bucket (`infra/bootstrap`) is untouched — it holds no app
data and negligible cost.

## Cost

Lambda (1024MB, ~10–20s/run) + S3 (24h object expiry) at single-user, low
volume: effectively $0/month, covered by AWS free tier. No always-on
compute, no database, no queue.

## Changelog & License

See [CHANGELOG.md](CHANGELOG.md) for release history and [LICENSE](LICENSE) (MIT).
