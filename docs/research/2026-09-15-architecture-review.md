# Architecture Review

Date: 2026-09-15
Scope: the whole system — `app/`, `lambda/`, `infra/main/`, `.github/workflows/`
— read from the tree at `8381c26` and checked against the live account
(`223376380711`, `us-east-1`) with read-only calls only

Nothing in this document has been fixed or filed beyond the issue that
tracks the document itself.

## Overall

The architecture is sound for what it is. The expensive mistakes were all
avoided: no always-on compute, no database, no queue, no per-tool auth. The
per-file comments in `infra/main/` and `app/lib/` show the trade-offs were
reasoned rather than defaulted — the in-memory rate limiter, the absent
catch-all lifecycle rule, and `ignore_changes = [image_uri]` each carry their
own justification, and each holds.

What is left is mostly credentials and blast radius, not design. Two findings
are worth acting on soon; the rest are cheap and can wait.

## Findings

Ranked for a single-operator, cost-sensitive site, not by textbook severity.

### 1. Two permanent IAM access keys, no OIDC

`aws_iam_access_key.vercel` (`infra/main/shared.tf:129`, injected into Vercel
at `:355-364`) and `aws_iam_access_key.ci_deploy` (`:194`, into GitHub
secrets). Grepping `infra/main/*.tf` and `.github/workflows/*.yml` for
`oidc`, `openid_connect`, `assume_role` or `id-token` finds only the Lambda
exec role's own trust policy — there is no federation anywhere.

Both key pairs are permanent and are not rotated on any schedule. The Vercel
key can `PutObject` into every bucket and `InvokeFunction` every Lambda; the
CI key can push images and call `UpdateFunctionCode` on all three functions.
A leaked Vercel environment variable or GitHub secret is therefore durable
account access, and nothing in the repo would surface it.

**Fix:** GitHub OIDC (`permissions: id-token: write` plus `role-to-assume` on
`aws-actions/configure-aws-credentials`) and Vercel's OIDC federation for the
app. Both delete a long-lived credential outright. Medium effort, no cost.

### 2. No concurrency ceiling on any Lambda

`reserved_concurrent_executions` appears nowhere in `infra/main/*.tf`, so the
provider default of `-1` applies and each function can scale to the account
limit.

This is the only thing in the system that can run away. At 1024 MB and a 60
second timeout (`environments.tf:170-171`, `:193-194`), unbounded concurrency
is real money, and the `$5` budget only notices after it is spent.

**Fix:** `reserved_concurrent_executions = 2` on both Lambda resources. Two
lines, no cost. It also makes the emergency throttle in
`docs/runbooks/incident-tool-down.md` a managed setting rather than drift the
next apply would undo.

### 3. Durable data in an ephemeral scratch bucket

`resume/current.*` lives in the audio bucket (`environments.tf:10`, lifecycle
at `:55-99`), which exists to hold objects that expire after a day.

That one choice is the root cause of four things documented elsewhere as
separate problems:

- `terraform destroy` fails with `BucketNotEmpty`, because no bucket sets
  `force_destroy` and this one never empties itself.
- The lifecycle configuration cannot have a catch-all rule, since an empty
  filter unions with the prefix rules and would expire the resume.
- The `ResumeHeadObjectNotFound` `s3:ListBucket` grant (`shared.tf:166-179`)
  exists only to turn a 403 into a 404 for `objectExists()`.
- `dev` and `stage` write into `main`'s bucket through `RESUME_BUCKET_NAME`,
  so the environments are not actually independent for resume data.

**Fix:** give resume data its own bucket, or move it to Vercel Blob. The audio
buckets can then take `force_destroy` safely and the kill switch works as
documented.

### 4. Client timeout equals backend timeout

The Lambda timeout is 60 seconds. `app/app/api/looper/process/route.ts`
invokes it synchronously (`InvocationType: "RequestResponse"`) and sets no
`maxDuration`, so the route runs under the plan default, capped at 60 seconds
on Hobby.

There is no headroom. A job that legitimately takes most of its budget cannot
return through the Vercel function in time, so a *successful* run surfaces to
the user as a platform 504 rather than a result. More generally, a synchronous
request is the wrong shape for a job measured in tens of seconds.

**Fix, immediate:** `export const maxDuration = 60` on the route, which at
least pins the behaviour instead of inheriting it.
**Fix, properly:** invoke asynchronously and poll, or hand the client a
presigned output URL to wait on.

### 5. Nothing alarms before the money is spent

The only monitoring in the account is `aws_budgets_budget.project`
(`shared.tf:457`) notifying the `budget_alerts` SNS topic. That is a spend
alarm, not a health alarm — a failing pipeline is discovered by trying to use
it.

**Fix:** an `aws_cloudwatch_metric_alarm` on `Errors` and on `Throttles` per
function, pointed at the SNS topic that already exists and is confirmed
(`SubscriptionsConfirmed: 1`, checked today). Ten alarms are free tier.

### 6. No Terraform validation in CI

`.github/workflows/deploy.yml` has no `validate`, no `fmt -check` and no
`plan`. `CLAUDE.md` already compensates with a manual rule, but both
`validate` and `fmt -check` need no AWS credentials at all and would close
most of the gap in the `test` job.

### 7. Log groups never expire

`/aws/lambda/bgm-looper-processor` and `-dev` both report
`retentionInDays: None`. Total stored today is 12 KB, so this is negligible
and listed only for completeness; it matters only if invocation volume grows.
`-stage` has no log group at all, which means that function has never been
invoked.

**Fix:** an `aws_cloudwatch_log_group` per function with
`retention_in_days = 14`.

## Considered and deliberately not recommended

**Slimming the ECR images.** The three images measure roughly 646 MB each,
about 2.0 GB total, which is **$0.20/month** at the $0.10/GB-month rate
`ARCHITECTURE.md:103-113` already established empirically for this account.
A multi-stage build or a smaller ffmpeg would be real work for pennies.
README's "roughly $1–2/month, dominated by ECR image storage" reads high
against that, but `ARCHITECTURE.md:114` is explicit that the range assumes
the unbuilt BGM Extractor — the estimate is right, the README summary is just
easy to misread in isolation.

**Per-environment Lambda exec roles.** All three functions share one role
scoped to all three buckets, and `lambda/src/looper/handler.py:14` takes
`bucket` straight from the event, so `dev`'s function can be told to write
`main`'s bucket. With one shared password and one operator the blast radius
is already everything, so separate roles would be ceremony rather than
isolation.

**The in-memory rate limiter, the shared password, public preview
deployments, no ECR rollback, and `ignore_changes = [image_uri]`.** Each is a
deliberate trade with a comment explaining it, and each still holds at this
scale.

## Priority

Do finding 1 and finding 2 first. Together they are the difference between a
leaked credential being recoverable and it being billable, and finding 2 is
two lines.
