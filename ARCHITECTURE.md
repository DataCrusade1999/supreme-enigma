# Architecture & Cost Snapshot — 2026-08-05

This is a point-in-time snapshot, not a living document — costs and
architecture will drift as BGM Extractor gets built and usage changes.
Re-measure rather than trusting these numbers indefinitely.

## What's live today

BGM Looper only. BGM Extractor (Demucs-based voice/music separation) exists
as an approved design spec and implementation plan
(`docs/superpowers/specs/2026-08-05-bgm-extractor-design.md`,
`docs/superpowers/plans/2026-08-05-bgm-extractor-plan.md`) but no
application code, Lambda, or Terraform resources for it have been built yet.
The IAM policies were already extended to make room for it.

## High-level flow

```
Browser
  │ (Cognito owner sign-in → signed HttpOnly cookie)
  ▼
Vercel (Next.js 15 + React 19, root_directory="web")
  │  proxy.ts gates /tools/bgm-looper, /api/looper/*, /keystatic, /api/keystatic/*
  │  (public site pages — home/about/projects/resume/contact — no auth)
  │
  ├─ POST /api/looper/upload-url  → presigned S3 PUT URL
  ├─ Browser PUTs file directly to S3 (Vercel never touches audio bytes)
  ├─ POST /api/looper/process      → sync-invokes Lambda, waits ~10-20s
  └─ returns presigned S3 GET URL  → <audio loop> preview + download
  │
  ▼
AWS (one account per branch, us-east-1, Terraform-managed)
```

## AWS resources, per branch (`main`/`dev`/`stage` — 3 accounts)

Each branch runs in its own account of the personal AWS organization, with no
trust or resource policy between them:

| Resource | main | dev | stage |
|---|---|---|---|
| AWS account (profile) | 223376380711 (`personal`) | 624586968135 (`personal-dev`) | 792682047320 (`personal-stage`) |
| Lambda function | `bgm-looper-processor` | `bgm-looper-processor-dev` | `bgm-looper-processor-stage` |
| S3 bucket | `portfolio-data-223376380711` | `portfolio-data-dev-624586968135` | `portfolio-data-stage-792682047320` |
| Sign-in | `auth.ashutosh-pandey.com` | `auth.dev.ashutosh-pandey.com` | `auth.stage.ashutosh-pandey.com` |
| Vercel deploy | `ashutosh-pandey.com` | `dev.ashutosh-pandey.com` | `stage.ashutosh-pandey.com` |

Each Lambda: container image (`librosa`, `numpy`, `soundfile`,
`pyloudnorm`, static `ffmpeg`), 1024MB, 60s timeout. Each S3 bucket: public
access blocked, CORS (PUT/GET, that environment's own origins), 1-day object
lifecycle on uploads and outputs. Each bucket also holds that environment's
own resume.

**In each account:**
- An ECR repo `bgm-looper-lambda` holding that branch's images
  (`main-<sha>`, `dev-<sha>` or `stage-<sha>`), tag mutability `IMMUTABLE`
  (no `:latest`, dropped 2026-08-06), lifecycle **keep-1**
- An exec role for the function (`bgm-looper-lambda-exec-<env>`), scoped to
  its own bucket
- A Cognito user pool and a Verified Permissions policy store
- Two OIDC identity providers (`token.actions.githubusercontent.com` and
  `oidc.vercel.com/<team slug>`) and federated roles. **No IAM users
  and no long-lived access keys anywhere** — both replaced permanent key
  pairs in #155, 2026-09-16.
  - The app's runtime role: `bgm-looper-vercel` in production (trusts the
    `production` Vercel environment), `bgm-looper-vercel-preview` in dev and
    stage (trusts `preview`). Each is scoped to its own account's bucket,
    Lambda and policy store.
  - `bgm-looper-ci-deploy`, assumed by `deploy.yml` (ECR push + Lambda
    update-function-code). Each account's role trusts only its own branch's
    ref, pinned with `StringEquals` on GitHub's immutable ID-qualified
    subject, so a fork PR cannot assume it.
  - The Terraform plan and apply roles used by `terraform.yml`.

**Shared:** one Vercel project in production's `infra/shared`, with each
environment's env vars scoped by target and `git_branch`.

## Auth

Sign-in through Cognito managed login (`/api/auth/login` → Cognito at
`auth.ashutosh-pandey.com`, or the environment's own `auth.<env>.` domain →
`/api/auth/callback`, authorization code with
PKCE), then the user's ID and refresh tokens in two HttpOnly cookies,
AES-256-GCM-encrypted with a key derived from `COOKIE_SECRET`.
`web/lib/route-gate.ts`'s `isGatedPath()` is the single source of truth
for what's protected.

Authorization: Amazon Verified Permissions, one policy store per environment
(all three from the same Cedar files), each with its own Cognito pool as
identity source. The proxy calls
`IsAuthorizedWithToken` for every gated request ($0.000005 each). Groups
`owner` and `friends`; see
`docs/superpowers/specs/2026-09-29-access-control-design.md`.

## CI/CD

`.github/workflows/deploy.yml`: `changes` job on push (whether `lambda/`
changed) → one `test` job (Trivy, lint, Vitest, pytest, Linux Playwright;
skipped on a `dev` push that does not touch `lambda/`, and on docs-only PRs)
→ `deploy` job (build/push image, `update-function-code`)
→ `release` job (main-only: auto-version from Conventional Commits, updates
`CHANGELOG.md`, creates GitHub Release, opens changelog-sync PR to `dev`). Windows and macOS
Playwright run only on PRs into `main`; `promotion-guard.yml` checks every
promotion PR. The layout is shaped by the free plan's 2,000 Actions
minutes/month (#320).
Vercel's own git integration deploys the app independently of GitHub
Actions.

## Infra-as-code

`infra/bootstrap` (one-time per account, just the TF state S3 bucket, never
destroyed), then six stacks with one state each:
- production: `infra/shared` (ECR, IAM, Cognito, the Vercel project and the
  other one-of-each resources, applied from `dev` only) and `infra/envs/main`
  (main's bucket, Lambda, alarm and Vercel env vars, through
  `infra/modules/environment`)
- dev and stage: `infra/nonprod/<env>/account` (through
  `infra/modules/nonprod-account` and `infra/modules/auth`) and
  `infra/nonprod/<env>/env` (through `infra/modules/nonprod-env`, which wraps
  `infra/modules/environment`)

Destroying each account's env stack, then its base stack, with production's
`shared` last, is the kill switch. Credentials come from the environment
(`AWS_PROFILE=personal`, `personal-dev` or `personal-stage` locally); no
backend or provider block names a profile, and each provider's
`allowed_account_ids` refuses the wrong account.

---

## Cost estimate

### What changed from an earlier back-of-envelope guess

- **FX rate was off**: an earlier estimate used ~83 INR/USD from memory;
  the actual live rate on 2026-08-05 is **~95.1 INR/USD**
  ([xe.com](https://www.xe.com/en-us/currencyconverter/convert/?Amount=1&From=USD&To=INR),
  [investing.com](https://www.investing.com/currencies/usd-inr)) — a ~15%
  understatement.
- **Looper's image is 3x bigger than documented**: CLAUDE.md and the
  design spec assumed ~200MB for BGM Looper's image; the actual images in
  ECR measure **644MB each**.

### Real data pulled from the account (Cost Explorer + Free Tier API, 2026-08-05)

- July 2026 actual total spend: **~$0.15** (mostly Cost Explorer API
  calls from prior sessions + ECR storage — not recurring app cost)
- Lambda: 314.928 GB-seconds used in July, **$0 cost** — free tier
  (400,000 GB-sec/mo) barely touched
- ECR pricing confirmed empirically at exactly **$0.10/GB-month** — no
  free-tier discount is being applied to this account
- Post-cleanup (2026-08-05), `bgm-looper-lambda` holds exactly 3 images
  (1.80GB total)

### Combined monthly estimate

| Component | Basis | Monthly (USD) | Monthly (INR) |
|---|---|---|---|
| BGM Looper — ECR (measured) | 3 × 644MB, keep-1 | $0.18 | ₹17 |
| BGM Looper — Lambda/S3 | real usage, well under free tier | ~$0 | ~₹0 |
| BGM Extractor — ECR (**estimated**, image not built yet) | 3–5GB × 3 branches, keep-1 | $0.90–$1.50 | ₹86–₹143 |
| BGM Extractor — Lambda | ~1,110 free runs/mo headroom before any charge | ~$0 | ~₹0 |
| Misc (S3, CloudWatch, etc.) | real, negligible | ~$0.01 | ~₹1 |
| **Total** | | **$1.09–$1.69** | **₹104–₹161** |

Still under the 200 INR/month target, with the range's width driven
entirely by the Demucs image size, which won't be known precisely until
it's actually built (Task 3/9 of the implementation plan) — re-measure
the same way `bgm-looper-lambda` was just measured once it exists.

### Worst case, if something runs away (2026-09-16)

The numbers above are steady-state. The ceiling is set by the account's
Lambda concurrency quota (`L-B99A9384`), which is **10**, not the default
1,000 — a reduced quota this account has never had raised. Ten concurrent
executions at 1024MB is ~$0.60/hour, ~$14/day, if every one of them ran
flat out continuously. That is the hard bound on a runaway invoke loop.

There is deliberately no `reserved_concurrent_executions` in the Terraform
lowering it further, because AWS will not allow one: reserving concurrency
is capped at "unreserved account concurrency minus 100", and with a quota
of 10 any non-zero reservation is rejected. Verified against the live
account — `put-function-concurrency 0` succeeds, `2` fails with
`InvalidParameterValueException ... below its minimum value of [10]`.

Two signals sit under that ceiling, at different speeds:

- `aws_cloudwatch_metric_alarm.lambda_invocation_rate` — >50 invocations
  in five minutes on any of the three functions, straight to the
  `bgm-looper-budget-alerts` SNS topic. Minutes.
- `aws_budgets_budget.project` — $5/month at 80% and 100%. Hours, because
  AWS budget evaluation lags actual usage.

The alarm is what makes the budget survivable; on its own the budget
reports after the money is gone.
