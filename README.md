# BGM Looper

Single-user web app: upload a background-music audio file, get back an
edited version that loops seamlessly — loudness-normalized, silence-trimmed,
beat-aligned loop point, crossfaded seam. Output keeps the input's original
format.

**Status:** design + implementation plan complete, code not yet written.
See `docs/superpowers/specs/2026-07-27-bgm-looper-design.md` (design) and
`docs/superpowers/plans/2026-07-27-bgm-looper-plan.md` (task-by-task build plan).

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

Full rationale and trade-offs: `docs/superpowers/specs/2026-07-27-bgm-looper-design.md`.

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
docs/superpowers/plans/   Implementation plan (17 tasks, TDD, checkbox-tracked)
```

## Prerequisites

- Node.js 20+, Python 3.12, Docker, Terraform ≥1.10
- An AWS account (personal) with credentials configured (`aws configure`)
- A Vercel account + API token
- ffmpeg on PATH (for running the Lambda pipeline locally)

## Setup

1. **Bootstrap the Terraform state bucket** (one-time, manual):
   ```bash
   cd infra/bootstrap
   terraform init && terraform apply
   ```
   Note the `state_bucket_name` output — put it in `infra/main/backend.tf`.

2. **Build and push the Lambda image**, then apply the rest of the infra:
   ```bash
   cd infra/main
   terraform init
   terraform apply -target=aws_ecr_repository.looper -var="vercel_api_token=..." -var="app_password=..." -var="github_repo=youruser/looper"

   cd ../../lambda
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
   docker build -t bgm-looper-lambda:latest .
   docker tag bgm-looper-lambda:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/bgm-looper-lambda:latest
   docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/bgm-looper-lambda:latest

   cd ../infra/main
   terraform apply -var="vercel_api_token=..." -var="app_password=..." -var="github_repo=youruser/looper"
   ```
   This creates the S3 bucket, Lambda function, IAM roles/user, and the
   Vercel project with all env vars wired up.

3. **Push to GitHub** — Vercel builds and deploys automatically via the git
   integration created in step 2.

Full step-by-step with exact Terraform files: `docs/superpowers/plans/2026-07-27-bgm-looper-plan.md`, Tasks 9–12 and 17.

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
terraform destroy -var="vercel_api_token=..." -var="app_password=..." -var="github_repo=youruser/looper"
```

Removes the Vercel project, Lambda, ECR repo, S3 audio bucket, and IAM
resources. The Terraform state bucket (`infra/bootstrap`) is untouched —
it holds no app data and negligible cost.

## Cost

Lambda (1024MB, ~10–20s/run) + S3 (24h object expiry) at single-user, low
volume: effectively $0/month, covered by AWS free tier. No always-on
compute, no database, no queue.
