# Looper observability — Design

**Date:** 2026-09-28
**Status:** Approved 2026-09-28. Written without a brainstorming session, at the owner's request; the owner reviewed the §3 decisions afterwards.
**Issue:** #287
**Epic:** #285 (phase 2 of 5). Builds on phase 1 (#286) as it stands after its cleanup PR.

## 1. Problem

After phase 1, a looper job runs in the background: S3 event → SQS → Lambda → DynamoDB. When a job is slow or fails, nothing ties those steps together. The Lambda writes plain-text logs to log groups that were created implicitly, are not in Terraform and never expire. There are no metrics beyond Lambda's built-in ones, and nothing shows all three environments in one place.

## 2. Goals and non-goals

Goals:

- Structured JSON logs from the Lambda, with the job key on every line, queryable in CloudWatch Logs Insights.
- An X-Ray trace per job showing the S3 download, the DSP pipeline, the S3 upload and each DynamoDB write as separate subsegments.
- Two custom metrics per environment: `JobSucceeded` and `JobRejected`.
- The three Lambda log groups managed by Terraform, with 14-day retention.
- Three saved Logs Insights queries and one CloudWatch dashboard covering all environments.

Non-goals:

- Tracing or logging from Vercel. The Next.js side stays on Vercel's own logs. X-Ray has no way to receive traces from Vercel without an OpenTelemetry collector, which is more than this phase needs.
- Linking the trace back to the S3 upload. S3 does not propagate a trace header into SQS, so each trace starts at the Lambda.
- New alarms. The phase 1 DLQ alarms and the existing invocation-rate alarms stay as they are.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Instrumentation library | Powertools for AWS Lambda (Python) v3: Logger, Tracer, Metrics | One dependency covers all three concerns. It is AWS's own library, so this is also how it's done in real AWS codebases. |
| Metrics transport | Embedded Metric Format (EMF) log lines, which Powertools writes | No `PutMetricData` calls or extra IAM permission. The metric arrives with the log line. |
| Metric dimensions | `service=looper`, `environment=<main/dev/stage>` | 2 metrics × 3 envs = 6 custom metrics, inside the 10 free. |
| Log retention | 14 days | Enough to debug last week's job. Currently the log groups never expire. |
| Log groups | Import the existing auto-created groups into Terraform | Recreating them would lose history. The `import` block (Terraform ≥ 1.5, this repo requires ≥ 1.10) is the lesson here. |
| Dashboard | One dashboard, one row per environment | Three dashboards are free. One keeps them to compare side by side. |

## 4. Lambda changes

`lambda/src/looper/handler.py`, starting from its phase 1 final state (SQS path only):

- The stdlib `logging` logger is replaced by `aws_lambda_powertools.Logger(service="looper")`. The handler is decorated with `@logger.inject_lambda_context`, which adds `cold_start`, `function_name` and `function_request_id` to every line.
- `logger.append_keys(job_key=key)` at the start of each job; `logger.remove_keys(["job_key"])` when it ends.
- `Tracer(service="looper")`, handler decorated with `@tracer.capture_lambda_handler`. Tracer auto-patches boto3, so S3 and DynamoDB calls become subsegments with no further code. The DSP call is wrapped in `@tracer.capture_method` so its duration shows as its own subsegment.
- `Metrics(namespace="BgmLooper", service="looper")`, handler decorated with `@metrics.log_metrics`. Default dimension `environment` from a new env var `LOOPER_ENV`.
- On `done`: `JobSucceeded` +1, and a log line `job finished` with `duration_ms` (download to final write).
- On a pipeline rejection: `JobRejected` +1. The existing `logger.exception` stays.

Decorator order, outermost first: `inject_lambda_context`, `capture_lambda_handler`, `log_metrics`.

`requirements.txt` gains `aws-lambda-powertools[tracer]>=3.0,<4.0`. The `tracer` extra pulls in `aws-xray-sdk`.

## 5. Infrastructure

In `infra/main/`:

- Both Lambda resources: `tracing_config { mode = "Active" }` and `LOOPER_ENV` in `environment.variables`.
- `aws_iam_role_policy_attachment` of `arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess` to `lambda_exec`.
- `aws_cloudwatch_log_group.looper` for_each over the three envs, named `/aws/lambda/<function name>`, `retention_in_days = 14`, brought in with `import` blocks. If a group does not exist yet (a function never invoked), its import block is dropped and Terraform creates it.
- Three `aws_cloudwatch_query_definition` resources across the three log groups:
  - **Looper: failed jobs.** Lines at `ERROR` level, newest first, with `job_key`.
  - **Looper: job duration.** `avg`, `pct 95` and `max` of `duration_ms` per day.
  - **Looper: cold starts.** Cold-start invocations per day, by function.
- `aws_cloudwatch_dashboard.looper`. For each environment, a row with two widgets:
  - Lambda: Invocations, Errors, and Duration p95 on the right axis.
  - Jobs: JobSucceeded, JobRejected, and DLQ ApproximateNumberOfMessagesVisible.

  Below the rows, one Logs Insights widget running the failed-jobs query across all three groups.

## 6. Rollout

One PR with Lambda and Terraform changes together. The Lambda change is backwards compatible: it reads `LOOPER_ENV` with a default of `"unknown"`, and tracing calls do nothing when tracing is off. Order: apply Terraform (env var, tracing, IAM, log groups) before merge, then merge, then deploy the image to dev. Promote as usual. The only risk is the log group import, and the plan checks it with `terraform plan` before applying.

## 7. Testing

- Unit tests, with pytest and moto:
  - the `done` path emits `JobSucceeded` with the `environment` dimension
  - the rejection path emits `JobRejected`
  - the `job finished` log line carries `job_key` and `duration_ms`

  The tests parse the EMF and log JSON Powertools prints to stdout. Tracing is disabled in tests with `POWERTOOLS_TRACE_DISABLED=1`.
- The existing handler tests pass a fake `LambdaContext`, since `inject_lambda_context` reads its attributes.
- Manual on dev: one upload, then open its trace in the X-Ray console (CloudWatch → Traces) and run each saved query.

## 8. Cost

- X-Ray: 100,000 traces a month are free, and one job is one trace.
- Custom metrics: 6, inside the 10 free.
- Dashboards: 1 of 3 free.
- Logs Insights: $0.005 per GB scanned. These log groups hold megabytes.
- Log storage falls once retention applies.

Expected additional cost: $0.
