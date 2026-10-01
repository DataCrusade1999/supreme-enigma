# Runbook — Terraform apply and teardown

## When to use this

Changing anything under `infra/shared/`, `infra/envs/` or `infra/modules/`, verifying that real infrastructure
matches the config, or tearing the project down.

Per-resource detail and the reasoning behind each quirk is in
`.claude/rules/infra.md`. This is the command sequence.

## Prerequisites

- Shared prerequisites in [README.md](README.md#shared-prerequisites).
- Four stacks, each with its own state and its own gitignored
  `terraform.tfvars` (copy that directory's `terraform.tfvars.example`):
  `infra/shared` (the one-of-each resources, applied from `main` only; seven
  required variables) and `infra/envs/dev`, `infra/envs/stage`,
  `infra/envs/main` (each environment's bucket, Lambda, alarm and two Vercel
  env vars; only `vercel_api_token`). A fresh clone fails with
  `No value for required variable` until they are set.
- `export AWS_PROFILE=personal` first. No backend block names a profile and
  `var.aws_profile` defaults to null, so Terraform uses whatever the
  environment provides — the wrong profile points at the wrong account.

## Plan before every merge

**CI validates nothing under `infra/`** — `deploy.yml` has no `validate`, no
`fmt -check`, no `plan`. Green test jobs say nothing about whether a
Terraform change applies. For any PR touching `infra/`, plan all four stacks
against real state before merging:

```bash
export AWS_PROFILE=personal
for d in infra/shared infra/envs/dev infra/envs/stage infra/envs/main; do
  (cd $d && terraform init -input=false && terraform plan -var-file=terraform.tfvars)
done
```

Do this in a scratch worktree if you have uncommitted work elsewhere. Confirm
`No changes.` for a refactor, or exactly the intended diff otherwise. This is
how the `vercel` v5 `sensitive`-now-required break was caught before it
reached anyone.

Two things `plan` will never tell you:

- **Lambda `image_uri` drift.** All three Lambda resources carry
  `lifecycle { ignore_changes = [image_uri] }` because CI updates the image
  out of band. Do not remove it. Staleness is checked by
  [stale-lambda-recovery.md](stale-lambda-recovery.md), not by Terraform.
- **Whether the budget alarm can reach anyone.** See below.

## Apply

From the directory of the stack that changed:

```bash
cd infra/envs/dev   # or infra/shared, infra/envs/stage, infra/envs/main
terraform apply -var-file=terraform.tfvars
```

When a change touches both, apply `infra/shared` first: the env stacks look
up the exec role, ECR repo, SNS topic and Vercel project by name.

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

If `confirmed` is `"0"`, click **Resubscribe** in the deactivated notification
email — that revives the same subscription ARN and leaves Terraform state
truthful. Only if that is impossible, from `infra/shared`:
`terraform apply -replace=aws_sns_topic_subscription.budget_alerts_email`.
To prove delivery end to end rather than infer it, `aws sns publish` one
message; it costs nothing.

## Kill switch: full teardown

The env stacks first, then `shared`:

```bash
for d in infra/envs/dev infra/envs/stage infra/envs/main infra/shared; do
  (cd $d && terraform destroy -var-file=terraform.tfvars)
done
```

Read all of this before running it.

### What goes

The Vercel project, all three Lambdas, the ECR repo (`force_delete = true`,
so images go with it), all three S3 audio buckets, and the IAM resources —
including both OIDC providers and the `bgm-looper-ci-deploy` and
`bgm-looper-vercel` roles. Re-applying recreates them under the same names, so
their ARNs are unchanged and neither CI nor the app needs anything copied by
hand. `deploy.yml` hardcodes the CI role ARN, and that ARN survives a recreate.

**The public portfolio goes down too.** The Vercel project serves the public
site and the gated tools from one deployment; there is no way to destroy the
AWS half and keep the site up.

`infra/bootstrap` is untouched — the Terraform state bucket survives, and so
does `aws_s3_account_public_access_block.account`, which lives there
deliberately so an account-wide guardrail outlives the kill switch.

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
aws s3 rm s3://portfolio-data-dev-223376380711 --recursive \
  --profile personal --region us-east-1
aws s3 rm s3://portfolio-data-stage-223376380711 --recursive \
  --profile personal --region us-east-1
```

*(The `BucketNotEmpty` failure is read from the absence of `force_destroy` in
`infra/modules/environment/main.tf` and S3's documented behaviour; the destroy has
not been run to confirm it. The empty-first commands are standard but
likewise unexercised here.)*

### Recovery: applying from scratch afterwards

A bare `terraform apply` will not work. The order: `infra/shared` with
`-target=aws_ecr_repository.looper`, the rest of `infra/shared`, push each
branch so CI builds an image, then `infra/envs/dev`, `infra/envs/stage`,
`infra/envs/main`. The step that catches people is that `bootstrap_image_tag`
in each `infra/envs/<env>/main.tf` still points at a tag from 2026-08-06 that
may no longer exist, and because of `ignore_changes` it is only read at
creation time. Update them to tags CI
has actually pushed before the final apply:

```bash
aws ecr describe-images --repository-name bgm-looper-lambda \
  --query 'imageDetails[].imageTags' \
  --profile personal --region us-east-1
```

Then re-add the hand-set Vercel variables and the analytics toggles from the
table above. Nothing to do for credentials — both roles come back with their
original ARNs, and there are no access keys or GitHub secrets in the loop.

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
