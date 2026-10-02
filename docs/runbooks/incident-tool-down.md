# Runbook — BGM Looper is failing

## When to use this

A user (realistically: you) cannot get a looped track out of
`/tools/bgm-looper` on any environment. Symptoms that route here: cannot sign
in, upload fails, `processing failed`, a download link that 403s.

If the pipeline is merely running old code, go to
[stale-lambda-recovery.md](stale-lambda-recovery.md) instead.

## Prerequisites

- Shared prerequisites in [README.md](README.md#shared-prerequisites).
- Vercel dashboard access (runtime logs for the frontend).
- Know which environment the report came from — the three are fully
  independent backends. The table in
  [release-promotion.md](release-promotion.md#environments) maps URL to
  Lambda and bucket.

## Triage by symptom

The request path is: browser → Next route on Vercel → presigned S3 PUT →
`POST /api/looper/process` → synchronous Lambda invoke → presigned S3 GET.
Each symptom below isolates one hop.

### Cannot sign in

- **Signed in, but sent to `/access-requested`** — the account is in neither
  Cognito group. The owner signing in with Google before
  [link-owner-google.md](link-owner-google.md) has been run lands here too.
- **`/access-denied?reason=authorization_unavailable`, or a `503` from an
  API** — Verified Permissions gave no decision within 2 s; the Vercel runtime
  log has `authz: no decision`.
- **`/login?error=state`** — the sign-in took over 10 minutes or began in
  another tab. Retry from `/login`.
- **`/login?error=failed`** — the code exchange failed, or its ID token failed
  verification; the Vercel runtime log has `auth: code exchange failed` or
  `auth: the ID token from the code exchange failed verification`.
- **A Cognito error page before any redirect** — the host is not in the app
  client's callback URLs. Only the apex, `dev.`, `stage.` and `localhost:3000`
  are registered.
- **Signed in but immediately bounced** — `COOKIE_SECRET` changed or is
  missing, invalidating every issued cookie. It is Terraform-managed, so a
  missing value means a failed apply, not a dashboard edit.

### Upload fails

The browser PUTs straight to S3 with a presigned URL, so Vercel logs will
show a successful `/api/looper/upload-url` and nothing else.

- **403 from S3** — the URL expired. They last 300 seconds; a user who left
  the tab open will hit this. Retrying is the fix.
- **403 with `SignatureDoesNotMatch`** — the size or content type sent does
  not match what was signed. `MAX_AUDIO_UPLOAD_BYTES` is 50 MB and is signed
  into the URL, so an oversized file is refused by S3 rather than by the app.
- **CORS error in the browser console** — the bucket's CORS configuration.
  It is Terraform-managed per bucket in `infra/modules/environment/main.tf`; check a
  recent apply did not drop it.

### `processing failed` (500 from `/api/looper/process`)

**The cause is not in the Vercel logs.** The route collapses both a Lambda
`FunctionError` and an unparseable payload into the same bare
`{"error":"processing failed"}` 500, so CloudWatch is the first stop, not the
second:

```bash
MSYS_NO_PATHCONV=1 aws logs tail "/aws/lambda/bgm-looper-processor" \
  --since 30m --profile personal --region us-east-1
```

(`-dev` / `-stage` for the other environments. `MSYS_NO_PATHCONV=1` is
required in Git Bash — see [README.md](README.md#shared-prerequisites). A log
group that does not exist at all means the function has never been invoked;
`bgm-looper-processor-stage` was in that state as of 2026-09-15.)

What to look for:

- **`Task timed out after 60.00 seconds`** — the function's timeout. A long
  or pathological input. Raising `timeout` in `infra/modules/environment/main.tf` is a
  deliberate cost decision, not a quick fix.
- **`Runtime exited: signal: killed` / OOM** — `memory_size` is 1024 MB.
  Same consideration.
- **`AccessDenied` on S3** — note which side threw it, because the two
  principals are scoped differently, both in `infra/modules/environment/main.tf`.
  Each environment's **Lambda exec role** (`bgm-looper-lambda-exec-<env>`) has
  bucket-wide `GetObject`/`PutObject` on **its own bucket only**, so a prefix
  is never its problem, but a payload naming another environment's bucket is:
  check that the deployment's `S3_BUCKET_NAME` matches the function it
  invoked. Otherwise the role, the policy attachment, or the bucket itself is
  wrong. The **Vercel roles** are the prefix-scoped ones: `uploads/*`,
  `outputs/*` and `news-desk/*` on the environment's own bucket (policy
  `bgm-looper-vercel-<env>`), plus `resume/*` on main's bucket from
  `infra/shared`. Production assumes `bgm-looper-vercel`, dev and stage
  `bgm-looper-vercel-preview`, so a preview deployment pointed at production's
  role ARN fails too. An `AccessDenied` from the app side on a key outside
  those prefixes is the expected shape.
- **A Python traceback from the DSP code** — a real pipeline bug. Reproduce
  locally against the same input (`cd lambda && .venv/Scripts/python -m pytest -q`,
  then a targeted test) and fix it through the normal PR flow.

### 504 / gateway timeout instead of a 500

A 504 from the platform rather than a 500 from the route means the Vercel
function gave up before the Lambda answered. The invoke is synchronous
(`InvocationType: "RequestResponse"`) against a 60-second Lambda, and
`web/app/api/looper/process/route.ts` sets no `maxDuration` — so the route
runs under Vercel's default limit for this plan, which is not pinned anywhere
in this repo. Confirm the current default in the Vercel dashboard before
concluding anything; if it is below 60 seconds, a slow-but-successful Lambda
run will always present this way, and the fix is an explicit `maxDuration` on
the route rather than anything in AWS.

This is the fork worth getting right: **500 means the Lambda failed, 504 means
it was too slow.** They have different fixes.

### Download link 403s

Two different causes look the same from the browser, and on `dev`/`stage`
they are genuinely indistinguishable:

- The **URL** expired. Presigned GETs last 300 seconds.
- The **object** expired. The `outputs/` lifecycle rule deletes after 1 day.

On `main` a missing key returns `NoSuchKey`, because the Vercel user holds
`s3:ListBucket` on that bucket (granted for `objectExists()`'s sake — see the
`ResumeHeadObjectNotFound` statement in `shared.tf`). On `dev` and `stage`
there is no `ListBucket`, so S3 returns 403 for a missing key and it reads
exactly like an expired signature. Discriminate server-side rather than
guessing:

```bash
aws s3api head-object --bucket portfolio-data-dev-223376380711   --key outputs/<uuid>.<ext> --profile personal --region us-east-1
```

Either way the fix is to reprocess; this only tells you whether to also
expect it to keep happening.

## Check the whole account is healthy

If several hops look wrong at once, check for something account-wide before
chasing each:

```bash
aws lambda get-function --function-name bgm-looper-processor \
  --query 'Configuration.{state:State,reason:StateReason,last:LastUpdateStatus}' \
  --profile personal --region us-east-1

aws s3api head-bucket --bucket portfolio-data-223376380711 \
  --profile personal --region us-east-1
```

## Rollback

If the incident began with a deployment, revert forward — see
[release-promotion.md](release-promotion.md#rollback). There is no ECR
rollback for the Lambda.

If the incident is cost rather than correctness (a runaway invoke loop), the
immediate lever is to throttle the function to zero concurrency rather than
tear anything down:

```bash
aws lambda put-function-concurrency --function-name bgm-looper-processor \
  --reserved-concurrent-executions 0 --profile personal --region us-east-1
```

Remove it with `delete-function-concurrency` once resolved.

**Zero is the only value this account can set.** Reserving concurrency is
capped at "unreserved account concurrency minus 100", and this account's
Lambda concurrency quota (`L-B99A9384`) is 10, not the default 1,000. Zero
takes nothing out of the pool and is accepted; anything higher is rejected.
Exercised against `bgm-looper-processor-dev` on 2026-09-16:

```
put-function-concurrency 0  → {"ReservedConcurrentExecutions": 0}
put-function-concurrency 2  → InvalidParameterValueException: Specified
    ReservedConcurrentExecutions for function decreases account's
    UnreservedConcurrentExecution below its minimum value of [10].
```

So this is a throttle, not a cap: there is no intermediate setting to fall
back to, which is also why `reserved_concurrent_executions` appears nowhere in
`infra/`.

It remains a stopgap rather than a setting. The attribute is unmanaged, so the
provider's default of `-1` applies, and the next `terraform apply` plans
`0 → -1` and calls `DeleteFunctionConcurrency`, lifting the throttle. Run
`terraform plan` before assuming it survived.

### Detection

`aws_cloudwatch_metric_alarm.lambda_invocation_rate` fires on more than 50
invocations in five minutes on any of the three functions, to the same
`bgm-looper-budget-alerts` SNS topic as the budget. Normal use is one
invocation per track processed. That alarm is what should reach you first —
the $5 budget also notifies, but AWS budget evaluation lags actual usage by
hours, so it reports after the money is gone.

Check which function is running away before throttling:

```bash
aws cloudwatch describe-alarms --alarm-name-prefix bgm-looper-processor \
  --profile personal --region us-east-1 \
  --query 'MetricAlarms[].{name:AlarmName,state:StateValue,reason:StateReason}'
```

The ceiling while you work is the quota: 10 concurrent executions at 1024MB,
roughly $0.60/hour. See
[ARCHITECTURE.md](../../ARCHITECTURE.md#worst-case-if-something-runs-away-2026-09-16).

## Escalation

See [README.md](README.md#escalation). This is the runbook whose natural
escalation is the AWS DevOps Agent's `investigate` flow — it correlates
CloudWatch, Lambda and S3 on its own and returns journal records after 5–8
minutes. `docs/aws-devops-agent.md` has the polling pattern and the
output-size limits.
