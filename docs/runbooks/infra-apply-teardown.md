# Runbook — Terraform apply and teardown

## When to use this

Changing anything under `infra/shared/`, `infra/envs/`, `infra/nonprod/` or `infra/modules/`, verifying that real infrastructure
matches the config, or tearing the project down.

Per-resource detail and the reasoning behind each quirk is in
`.claude/rules/infra.md`. This is the command sequence.

## Prerequisites

- Shared prerequisites in [README.md](README.md#shared-prerequisites).
- Six stacks in three accounts, each with its own state and its own gitignored
  `terraform.tfvars` (copy that directory's `terraform.tfvars.example`):
  - Production, 223376380711, profile `personal`: `infra/shared` (the
    one-of-each resources, applied from `dev` only; seven required variables)
    and `infra/envs/main` (main's bucket, Lambda, alarm and Vercel env vars;
    only `vercel_api_token`).
  - Dev, 624586968135, profile `personal-dev`, and stage, 792682047320,
    profile `personal-stage`: `infra/nonprod/<env>/account` (OIDC, CI roles,
    ECR, SNS, SES, Cognito and Verified Permissions; `vercel_api_token`,
    `alert_email`, `google_client_id`, `google_client_secret`) and
    `infra/nonprod/<env>/env` (the bucket, Lambda, alarm, resume grant and
    preview Vercel vars; only `vercel_api_token`). Each nonprod account keeps
    its state in its own `bgm-looper-tf-state-<account id>`.

  A fresh clone fails with `No value for required variable` until they are set.
- Export the stack's profile first: `AWS_PROFILE=personal` for `shared` and
  `envs/main`, `personal-dev` or `personal-stage` for a nonprod stack. No
  backend block names a profile and `var.aws_profile` defaults to null, so
  Terraform uses whatever the environment provides. Every provider sets
  `allowed_account_ids`, so the wrong profile fails with
  `AWS account ID not allowed` before changing anything.

## Plan before every merge

The `Terraform` workflow (`.github/workflows/terraform.yml`) lints and plans
every PR that touches `infra/`, and posts the plans of the base branch's stacks
as one PR comment (`.github/scripts/tf-stacks.sh plan`): `shared` and
`nonprod/dev/*` on a PR into `dev`, `nonprod/stage/*` into `stage`,
`envs/main` into `main`. Read it before merging: `No changes`
for a refactor, or exactly the intended diff, and no `⚠ destroys or replaces`
line you did not intend.

When the workflow cannot run, plan the stacks locally against real state, each
under its own account's profile:

```bash
for s in shared:personal envs/main:personal \
         nonprod/dev/account:personal-dev nonprod/dev/env:personal-dev \
         nonprod/stage/account:personal-stage nonprod/stage/env:personal-stage; do
  d=${s%%:*}; p=${s##*:}
  (cd infra/$d && AWS_PROFILE=$p terraform init -input=false && AWS_PROFILE=$p terraform plan -var-file=terraform.tfvars)
done
```

Do this in a scratch worktree if you have uncommitted work elsewhere. Confirm
`No changes.` for a refactor, or exactly the intended diff otherwise. This is
how the `vercel` v5 `sensitive`-now-required break was caught before it
reached anyone.

Two things `plan` will never tell you:

- **Lambda `image_uri` drift.** All three Lambda resources (one per account) carry
  `lifecycle { ignore_changes = [image_uri] }` because CI updates the image
  out of band. Do not remove it. Staleness is checked by
  [stale-lambda-recovery.md](stale-lambda-recovery.md), not by Terraform.
- **Whether the budget alarm can reach anyone.** See below.

## Apply

Merging applies. A push to `dev` applies `shared`, then `nonprod/dev/account`,
then `nonprod/dev/env`; a push to `stage` applies `nonprod/stage/account` then
`nonprod/stage/env`; a push to `main` applies `envs/main`. `shared` is applied
from `dev` only, so a `shared` change reaches production when it merges to
`dev`. A plan that deletes or replaces anything stops before applying; once
you have read it, apply it from the branch that owns the stack:

```bash
gh workflow run terraform.yml --ref dev -f stack=nonprod/dev/env -f confirm=apply-destroys
```

A nonprod stack applies as its own account's `bgm-looper-tf-apply`
(`AdministratorAccess`, scoped by the account boundary), `shared` and
`envs/main` as `bgm-looper-tf-apply-prod`. Any fix to a broken role or
workflow is a local apply.

### Local apply (break-glass)

From the directory of the stack that changed, under that stack's profile:

```bash
cd infra/nonprod/dev/env   # or infra/shared, infra/envs/main, infra/nonprod/<env>/account
AWS_PROFILE=personal-dev terraform apply -var-file=terraform.tfvars
```

When a change touches both stacks of one account, apply the base first:
`infra/shared` before `infra/envs/main` (the env stack looks up the Vercel
role, ECR repo, SNS topic and Vercel project by name), and
`infra/nonprod/<env>/account` before `infra/nonprod/<env>/env` (which reads
the account stack's outputs from the same account's state).

Re-read the plan output in the confirmation prompt rather than typing `yes`
from memory; the only destructive resources here are the S3 buckets and the
Vercel project, and both are catastrophic to replace.

Afterwards, check the things Terraform does not manage and will not report
missing:

| Setting | Where | Effect if absent |
|---|---|---|
| `KEYSTATIC_GITHUB_CLIENT_ID`, `KEYSTATIC_GITHUB_CLIENT_SECRET`, `KEYSTATIC_SECRET` | Vercel dashboard, by hand | Every build fails at `Failed to collect configuration for /api/keystatic/[...params]` |
| `BUTTONDOWN_API_KEY` | Vercel dashboard, by hand | `/tools/newsletter-admin` shows `BUTTONDOWN_API_KEY is not set`; `POST /api/newsletter/send` 502s |
| Web Analytics + Speed Insights | Vercel dashboard toggles | No data, despite `<Analytics />` being mounted in `layout.tsx` |

## Verify the budget alarm can reach you

`terraform plan` reports `No changes` whether the SNS email subscription is
confirmed, pending, or deleted — the provider does not reconcile an `email`
subscription's real state, and confirmation happens when a human clicks a
link. It will never self-heal and never warn, so `No changes` is not evidence
the `$5` cap can notify anyone. Check the API:

```bash
aws sns get-topic-attributes \
  --topic-arn arn:aws:sns:us-east-1:223376380711:bgm-looper-budget-alerts \
  --profile personal --region us-east-1 \
  --query 'Attributes.{confirmed:SubscriptionsConfirmed,pending:SubscriptionsPending}'
```

Healthy (checked 2026-09-15):

```json
{ "confirmed": "1", "pending": "0" }
```

Dev and stage each have their own `bgm-looper-budget-alerts` topic, with an
email subscription and no budget. It carries their Lambda's invocation alarm.
Check those topics the same way, with that account's ARN
(`arn:aws:sns:us-east-1:<account id>:bgm-looper-budget-alerts`) and
`--profile personal-dev` or `personal-stage`.

If `confirmed` is `"0"`, click **Resubscribe** in the deactivated notification
email — that revives the same subscription ARN and leaves Terraform state
truthful. Only if that is impossible, from `infra/shared`:
`terraform apply -replace=aws_sns_topic_subscription.budget_alerts_email`.
To prove delivery end to end rather than infer it, `aws sns publish` one
message; it costs nothing.

## Kill switch: full teardown

In each account, the env stack first, then its base stack. Production's
`shared` goes last, because it owns the Vercel project that the nonprod env
stacks' Vercel variables belong to:

```bash
for s in nonprod/dev/env:personal-dev nonprod/dev/account:personal-dev \
         nonprod/stage/env:personal-stage nonprod/stage/account:personal-stage \
         envs/main:personal shared:personal; do
  d=${s%%:*}; p=${s##*:}
  (cd infra/$d && AWS_PROFILE=$p terraform destroy -var-file=terraform.tfvars)
done
```

Read all of this before running it.

### What goes

The Vercel project, all three Lambdas, the three ECR repos (one per account,
`force_delete = true`, so images go with them), all three S3 data buckets, the
three Cognito pools and Verified Permissions stores, and the IAM resources in
each account: both OIDC providers, `bgm-looper-ci-deploy`, the Terraform plan
and apply roles, `bgm-looper-vercel` in production and
`bgm-looper-vercel-preview` in dev and stage, and each environment's
`bgm-looper-lambda-exec-<env>` role. Re-applying recreates them under the same
names, so their ARNs are unchanged and neither CI nor the app needs anything
copied by hand. `deploy.yml` hardcodes each branch's CI role ARN, and those
ARNs survive a recreate.

**The public portfolio goes down too.** The Vercel project serves the public
site and the gated tools from one deployment; there is no way to destroy the
AWS half and keep the site up.

`infra/bootstrap` is untouched. Each account's Terraform state bucket survives
(production's from the `default` workspace, dev's and stage's from the `dev`
and `stage` workspaces), and so does each account's
`aws_s3_account_public_access_block.account`, which lives there deliberately
so an account-wide guardrail outlives the kill switch.

### It will fail on the buckets first

None of the `aws_s3_bucket` resources set `force_destroy`, so Terraform
refuses to delete a non-empty bucket and the destroy aborts with
`BucketNotEmpty`. The `dev` and `stage` buckets usually empty themselves
within a day via the lifecycle rules, but **main's bucket never does**: the
lifecycle configuration deliberately has no catch-all rule, so
`resume/current.*` persists indefinitely and `resume/archive/*` for a year.

So emptying main's bucket is a real data-destroying step, not a formality —
it deletes the published resume PDF and its archive. Save what you want
first:

```bash
aws s3 cp s3://portfolio-data-223376380711/resume/ ./resume-backup/ \
  --recursive --profile personal --region us-east-1

aws s3 rm s3://portfolio-data-223376380711 --recursive \
  --profile personal --region us-east-1
aws s3 rm s3://portfolio-data-dev-624586968135 --recursive \
  --profile personal-dev --region us-east-1
aws s3 rm s3://portfolio-data-stage-792682047320 --recursive \
  --profile personal-stage --region us-east-1
```

Dev's and stage's buckets also hold their own `resume/current.*`, published
from those previews; back them up the same way if they matter.

*(The `BucketNotEmpty` failure is read from the absence of `force_destroy` in
`infra/modules/environment/main.tf` and S3's documented behaviour; the destroy has
not been run to confirm it. The empty-first commands are standard but
likewise unexercised here.)*

### Recovery: applying from scratch afterwards

A bare `terraform apply` will not work. The order:
1. Production: `infra/shared` with `-target=aws_ecr_repository.looper`, then
   the rest of `infra/shared`.
2. Dev and stage: `infra/nonprod/<env>/account`, locally, in two passes:
   first `-var webauthn_enabled=false`, then a plain apply (the
   `RelyingPartyId` failure in `.claude/rules/infra.md`).
3. Push each branch so CI builds and pushes an image into that account's ECR.
4. `infra/envs/main`, `infra/nonprod/dev/env`, `infra/nonprod/stage/env`.

The step that catches people is `bootstrap_image_tag` in `infra/envs/main/main.tf`
and `infra/nonprod/<env>/env/main.tf`. It points at a tag from the stack's
first apply that may no longer exist, and because of `ignore_changes` it is
only read at creation time. Update each one to a tag CI has actually pushed
before the final apply:

```bash
aws ecr describe-images --repository-name bgm-looper-lambda \
  --query 'imageDetails[].imageTags' \
  --profile personal --region us-east-1   # personal-dev / personal-stage for theirs
```

Then re-add the hand-set Vercel variables and the analytics toggles from the
table above. Nothing to do for credentials — every role comes back with its
original ARN, and there are no access keys or GitHub secrets in the loop.

`infra/bootstrap` has no persisted state and is gitignored, so a bare
`terraform apply` there proposes recreating the existing state bucket and
fails with `BucketAlreadyOwnedByYou`. Use `-target` for individual resources.

## Rollback

Terraform has no undo. If an apply did something unintended:

- **Nothing destroyed** — revert the `.tf` change and apply again.
- **Something destroyed** — recreate it with an apply, and accept that
  anything data-bearing (bucket contents) is gone. A destroyed bucket name
  can be reused immediately, but its objects cannot be recovered.
- **State is wrong rather than infrastructure** — `terraform import` the real
  resource rather than applying over it. Applying over a resource Terraform
  has lost track of creates a duplicate or collides, which is what a plan
  against the live Vercel project showed for `BUTTONDOWN_API_KEY`.

## Escalation

See [README.md](README.md#escalation). For cost questions specifically, the
AWS DevOps Agent answers them directly against this account —
`docs/aws-devops-agent.md`, "What it's used for here".
