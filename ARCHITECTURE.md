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
  │ (shared password → signed HttpOnly cookie)
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
AWS (personal account 223376380711, us-east-1, Terraform-managed)
```

## AWS resources, per branch (`main`/`dev`/`stage` — 3 fully independent backends)

| Resource | main | dev | stage |
|---|---|---|---|
| Lambda function | `bgm-looper-processor` | `-dev` | `-stage` |
| S3 bucket | `bgm-looper-audio-<acct>` | `-dev-<acct>` | `-stage-<acct>` |
| Vercel deploy | `bgm-looper.vercel.app` | `-git-dev-...` | `-git-stage-...` |

Each Lambda: container image (`librosa`, `numpy`, `soundfile`,
`pyloudnorm`, static `ffmpeg`), 1024MB, 60s timeout. Each S3 bucket: public
access blocked, CORS (PUT/GET, `*` origin), 1-day object lifecycle.

**Shared across all 3 branches** (not duplicated per-branch):
- One ECR repo `bgm-looper-lambda` — per-branch tag prefixes
  (`main-<sha>`, `dev-<sha>`, `stage-<sha>`), tag mutability `IMMUTABLE`
  (no `:latest`, dropped 2026-08-06), lifecycle **keep-1 per prefix**
  (tightened 2026-08-05, was keep-5)
- One `lambda_exec` IAM role, scoped to all 3 buckets, shared by all 3
  functions
- Two OIDC identity providers (`token.actions.githubusercontent.com` and
  `oidc.vercel.com/<team slug>`) and one federated role each. **No IAM users
  and no long-lived access keys anywhere** — both replaced permanent key
  pairs in #155, 2026-09-16.
  - `bgm-looper-vercel`, assumed by the app at runtime (S3 put/get + Lambda
    invoke, scoped to all 6 current functions/buckets — already includes the
    not-yet-created Demucs ones, per the IAM policy extension already
    applied). Trusts the `production` and `preview` Vercel environments.
  - `bgm-looper-ci-deploy`, assumed by `deploy.yml` (ECR push + Lambda
    update-function-code). Trusts only `refs/heads/{main,dev,stage}`, pinned
    with `StringEquals` on GitHub's immutable ID-qualified subject, so a fork
    PR cannot assume it.
- One Vercel project, env vars overridden per branch via
  `git_branch`-scoped Terraform resources

## Auth

Single shared password (Vercel env var), constant-time compare in
`/api/login`, HttpOnly signed cookie (`COOKIE_SECRET`, payload is just the
literal string `"authenticated"`) — no accounts, no per-user state.
`web/lib/route-gate.ts`'s `isGatedPath()` is the single source of truth
for what's protected.

## CI/CD

`.github/workflows/deploy.yml`: `test` job (Lambda pytest + app vitest) on
every push/PR → `changes` job (path-filters whether `lambda/` changed) →
`deploy` job (build/push image, `update-function-code`) → `release` job
(main-only: auto-version from Conventional Commits, updates
`CHANGELOG.md`, creates GitHub Release, opens changelog-sync PR to `dev`).
Vercel's own git integration deploys the app independently of GitHub
Actions.

## Infra-as-code

Two Terraform layers: `infra/bootstrap` (one-time, just the TF state S3
bucket, never destroyed) and `infra/main` (everything else — S3, ECR,
Lambda, IAM, Vercel project; `terraform destroy` here is the kill switch).
Provider is pinned to the `personal` AWS CLI profile in `providers.tf`,
not read from the shell.

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
