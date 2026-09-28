# Looper Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Structured logs, X-Ray traces and two custom metrics from the looper Lambda, Terraform-managed log groups with retention, saved Logs Insights queries and one dashboard.

**Architecture:** Powertools for AWS Lambda (Python) wraps the existing SQS handler: Logger writes JSON with the job key, Tracer turns boto3 calls and the DSP call into X-Ray subsegments, and Metrics writes EMF lines that CloudWatch turns into `BgmLooper/JobSucceeded` and `JobRejected`. Terraform turns on active tracing, imports the auto-created log groups, and adds query definitions and a dashboard.

**Tech Stack:** Python 3.12, `aws-lambda-powertools[tracer]` v3, pytest + moto; Terraform `aws` ~> 6.62 (lock 6.63.0), Terraform ≥ 1.10 (import blocks with `for_each`).

**Spec:** `docs/superpowers/specs/2026-09-28-looper-observability-design.md`. Issue #287, epic #285.

**Starts after:** phase 1 (#286) is complete, including its cleanup PR. `handler.py` has only the SQS path, `var.looper_async_envs` is gone, and `aws_sqs_queue.looper_jobs_dlq` exists for all three envs.

## Global Constraints

- Powertools names: `Logger(service="looper")`, `Tracer(service="looper")`, `Metrics(namespace="BgmLooper", service="looper")`.
- Metric names exactly `JobSucceeded` and `JobRejected`, unit `Count`, default dimension `environment` from env var `LOOPER_ENV` (fallback `"unknown"`).
- Log line on success: message `job finished`, key `duration_ms` (int). Every line during a job carries `job_key`.
- Log retention: 14 days. Log group names: `/aws/lambda/bgm-looper-processor`, `-dev`, `-stage`.
- Decorator order on `handler`, outermost first: `@logger.inject_lambda_context`, `@tracer.capture_lambda_handler`, `@metrics.log_metrics`.
- Every manual `aws` CLI call: `--profile personal --region us-east-1`.
- Terraform: plan against real state, apply with the owner's go-ahead before merge, then plan shows `No changes.`.
- While Actions billing blocks CI: local suites plus the owner's go-ahead gate the merge, and the Lambda is deployed by hand as in the phase 1 plan's "Deploying the Lambda while Actions is blocked".
- Commits end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.

## Review Focus

- **`LOOPER_ENV` unset** (image deployed before Terraform applied, or a local run): metrics must still flush with `environment=unknown`, not raise. Test in Task 1.
- **A job that raises a transient error**: it must log an `ERROR` line carrying its `job_key` before the exception leaves the handler, or the failed-jobs query and dashboard widget never see a job on its way to the DLQ (the runtime's own traceback line has no `level` or `job_key`). The `job_key` must then be removed from the logger, or the next record in a warm container logs under the wrong key. Test in Task 1.
- **A log group that does not exist yet**: its `import` block fails the plan. Task 2 checks existence before writing the block.
- **Duplicate delivery that loses the final-write race**: must not count `JobSucceeded`, or the metric double-counts. Test in Task 1.
- **Cold-start query on booleans**: Powertools writes `"cold_start": true`; the query must match it. Checked by running the query on dev in Task 2.

---

### Task 1: Powertools in the handler

**Files:**
- Modify: `lambda/requirements.txt`
- Modify: `lambda/tests/conftest.py`
- Modify: `lambda/src/looper/handler.py`
- Modify: `lambda/tests/test_handler.py`

**Interfaces:**
- Consumes: phase 1's `handler.py` (functions `handler`, `_process_record`, `_process_upload`, `_write_status -> bool`, `_to_dynamo`, `_paths`, constants `TMP_DIR`, `FAILED_MESSAGE`).
- Produces: module globals `logger`, `tracer`, `metrics`; new function `_run_pipeline(input_path, output_path) -> dict`; `lambda_context` pytest fixture in `conftest.py`. EMF metrics and log fields as in Global Constraints, which Task 2's queries and dashboard read.

- [ ] **Step 0: Branch** — `git switch dev && git pull && git switch -c feat/looper-observability`

- [ ] **Step 1: Add the dependency and install it**

Append to `lambda/requirements.txt`:

```
aws-lambda-powertools[tracer]>=3.0,<4.0
```

Run: `lambda/.venv/Scripts/python -m pip install -r lambda/requirements.txt`

- [ ] **Step 2: Test fixtures.** Append to `lambda/tests/conftest.py`:

```python
# Powertools reads these at import time, like the credentials above.
os.environ["POWERTOOLS_TRACE_DISABLED"] = "1"
os.environ["LOOPER_ENV"] = "test"

from dataclasses import dataclass  # noqa: E402

import pytest  # noqa: E402


@dataclass
class FakeLambdaContext:
    # The attributes Logger.inject_lambda_context reads.
    function_name: str = "bgm-looper-processor-test"
    memory_limit_in_mb: int = 1024
    invoked_function_arn: str = "arn:aws:lambda:us-east-1:123456789012:function:bgm-looper-processor-test"
    aws_request_id: str = "test-request-id"


@pytest.fixture
def lambda_context():
    return FakeLambdaContext()


@pytest.fixture(autouse=True)
def _log_to_captured_stdout(capsys):
    # Powertools' Logger binds its handler to sys.stdout when looper.handler is
    # imported, during collection, before capsys swaps sys.stdout. Rebinding it
    # here lets tests read log lines; EMF metric lines are print()ed at flush
    # time and are captured either way.
    import sys

    from looper import handler as handler_module

    handler_module.logger.registered_handler.setStream(sys.stdout)
```

Treat the first run of Step 5 as the check on this fixture: if `job finished` lines are missing from `capsys` output, the fixture is not taking effect; if they appear, it is doing its job.

- [ ] **Step 3: Point every existing handler call at the fake context.** In `lambda/tests/test_handler.py`, each test that calls `handler_module.handler(..., None)` now takes `lambda_context` as a parameter and passes it instead of `None`:

```bash
cd lambda && sed -i 's/handler_module.handler(\(.*\), None)/handler_module.handler(\1, lambda_context)/' tests/test_handler.py
```

Then add `lambda_context` to the parameter list of every test the sed touched (`grep -n "lambda_context)" tests/test_handler.py` lists them). For example `def test_s3_test_event_is_skipped(aws):` becomes `def test_s3_test_event_is_skipped(aws, lambda_context):`. Calls split across lines (`handler_module.handler(sqs_event(...), None)` on one line is the only form phase 1 wrote, but check `grep -n "None)" tests/test_handler.py` returns nothing handler-related).

- [ ] **Step 4: Write the failing tests.** Append to `lambda/tests/test_handler.py`:

```python
def printed_json(capsys) -> list[dict]:
    lines = capsys.readouterr().out.splitlines()
    return [json.loads(line) for line in lines if line.startswith("{")]


def metric_lines(capsys) -> list[dict]:
    return [line for line in printed_json(capsys) if "_aws" in line]


def test_done_job_emits_success_metric_and_duration(aws, monkeypatch, capsys, lambda_context):
    s3, _ = aws
    s3.put_object(Bucket=BUCKET, Key=UPLOAD_KEY, Body=b"audio")
    monkeypatch.setattr(handler_module, "process", fake_process)

    handler_module.handler(sqs_event(UPLOAD_KEY), lambda_context)

    lines = printed_json(capsys)
    metrics = [line for line in lines if "_aws" in line]
    assert len(metrics) == 1
    assert "JobSucceeded" in metrics[0]
    assert "JobRejected" not in metrics[0]
    assert metrics[0]["environment"] == "test"
    finished = [line for line in lines if line.get("message") == "job finished"]
    assert len(finished) == 1
    assert finished[0]["job_key"] == UPLOAD_KEY
    assert isinstance(finished[0]["duration_ms"], int)
    assert finished[0]["cold_start"] in (True, False)


def test_rejected_job_emits_rejection_metric(aws, monkeypatch, capsys, lambda_context):
    s3, _ = aws
    s3.put_object(Bucket=BUCKET, Key=UPLOAD_KEY, Body=b"not audio")

    def reject(input_path, output_path, target_lufs=-14.0):
        raise ValueError("could not decode")

    monkeypatch.setattr(handler_module, "process", reject)

    handler_module.handler(sqs_event(UPLOAD_KEY), lambda_context)

    (line,) = metric_lines(capsys)
    assert "JobRejected" in line
    assert "JobSucceeded" not in line


def test_duplicate_that_loses_the_race_is_not_counted(aws, monkeypatch, capsys, lambda_context):
    s3, table = aws
    s3.put_object(Bucket=BUCKET, Key=UPLOAD_KEY, Body=b"audio")

    def other_invocation_finishes(input_path, output_path, target_lufs=-14.0):
        table.put_item(Item={"jobKey": UPLOAD_KEY, "status": "done", "outputKey": "outputs/other.wav"})
        return fake_process(input_path, output_path)

    monkeypatch.setattr(handler_module, "process", other_invocation_finishes)

    handler_module.handler(sqs_event(UPLOAD_KEY), lambda_context)

    assert all("JobSucceeded" not in line for line in metric_lines(capsys))


def test_transient_failure_is_logged_with_its_key_then_the_key_is_cleared(
    aws, monkeypatch, capsys, lambda_context
):
    # Nothing uploaded, so the download raises. The failure has to reach the
    # failed-jobs query with its key, and a warm container must not carry the
    # key into the next record's log lines.
    monkeypatch.setattr(handler_module, "process", fake_process)

    with pytest.raises(ClientError):
        handler_module.handler(sqs_event(UPLOAD_KEY), lambda_context)

    handler_module.logger.info("after")
    lines = printed_json(capsys)
    (failed,) = [line for line in lines if line.get("level") == "ERROR"]
    assert failed["job_key"] == UPLOAD_KEY
    (after,) = [line for line in lines if line.get("message") == "after"]
    assert "job_key" not in after


def test_metrics_flush_without_looper_env(aws, monkeypatch, capsys, lambda_context):
    # The default dimension is read at import; an unset LOOPER_ENV must still
    # flush rather than raise. Simulated by resetting the dimension.
    handler_module.metrics.set_default_dimensions(environment="unknown")
    try:
        s3, _ = aws
        s3.put_object(Bucket=BUCKET, Key=UPLOAD_KEY, Body=b"audio")
        monkeypatch.setattr(handler_module, "process", fake_process)

        handler_module.handler(sqs_event(UPLOAD_KEY), lambda_context)

        (line,) = metric_lines(capsys)
        assert line["environment"] == "unknown"
    finally:
        handler_module.metrics.set_default_dimensions(environment="test")
```

- [ ] **Step 5: Run to verify they fail**

Run: `cd lambda && .venv/Scripts/python -m pytest tests/test_handler.py -q`
Expected: the five new tests fail (no EMF lines, no `job finished` line, `handler_module.logger` has no `.info` output as JSON / no `metrics` attribute). The existing tests still pass.

- [ ] **Step 6: Instrument `lambda/src/looper/handler.py`.** Make these edits to the phase 1 final file:

Replace the imports and module globals down to `TMP_DIR` with:

```python
import json
import os
import time
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import unquote_plus

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from botocore.exceptions import ClientError

from looper.pipeline import process

logger = Logger(service="looper")
# Patches boto3, so every S3 and DynamoDB call becomes an X-Ray subsegment.
tracer = Tracer(service="looper")
# EMF: the metrics ride on a log line, so no PutMetricData call or permission.
metrics = Metrics(namespace="BgmLooper", service="looper")
metrics.set_default_dimensions(environment=os.environ.get("LOOPER_ENV", "unknown"))

s3 = boto3.client("s3")

TMP_DIR = "/tmp"
```

Replace `handler` with:

```python
@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def handler(event: dict, context) -> None:
    for record in event["Records"]:
        _process_record(record)
```

Replace `_process_upload` with these three functions:

```python
def _process_upload(bucket: str, key: str) -> None:
    logger.append_keys(job_key=key)
    try:
        _run_job(bucket, key)
    except Exception:
        # Raised again for SQS to retry. Logged first so the failed-jobs query
        # sees a job on its way to the DLQ, with its key; the runtime's own
        # traceback line has neither.
        logger.exception("Job failed; SQS will retry it")
        raise
    finally:
        # A warm container handles the next record with the same logger.
        logger.remove_keys(["job_key"])


def _run_job(bucket: str, key: str) -> None:
    started = time.monotonic()
    table = boto3.resource("dynamodb").Table(os.environ["JOBS_TABLE_NAME"])
    output_key = "outputs/" + key.removeprefix("uploads/")

    if not _write_status(table, key, "processing"):
        return

    # Errors around the pipeline are transient: raising hands the message back to
    # SQS, which retries it and moves it to the DLQ after 3 receives.
    input_path, output_path = _paths(key)
    s3.download_file(bucket, key, input_path)

    # Errors inside it are permanent: record the failure and let SQS delete the message.
    try:
        meta = _run_pipeline(input_path, output_path)
    except Exception:
        logger.exception("Pipeline rejected the upload")
        metrics.add_metric(name="JobRejected", unit=MetricUnit.Count, value=1)
        _write_status(table, key, "failed", error=FAILED_MESSAGE)
        return

    s3.upload_file(output_path, bucket, output_key)
    if _write_status(table, key, "done", outputKey=output_key, result=_to_dynamo(meta)):
        metrics.add_metric(name="JobSucceeded", unit=MetricUnit.Count, value=1)
        logger.info(
            "job finished",
            extra={"duration_ms": round((time.monotonic() - started) * 1000)},
        )


@tracer.capture_method
def _run_pipeline(input_path: str, output_path: str) -> dict:
    # Its own subsegment, so the trace separates DSP time from S3 time.
    return process(input_path, output_path)
```

In `_process_record` and `_write_status`, the existing `logger.info(...)` calls keep working: Powertools `Logger` accepts the same `%s` arguments. Delete the old `import logging`, `logger = logging.getLogger()` and `logger.setLevel(logging.INFO)` lines if any remain.

- [ ] **Step 7: Run the full suite**

Run: `cd lambda && .venv/Scripts/python -m pytest -q`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add lambda/requirements.txt lambda/tests/conftest.py lambda/tests/test_handler.py lambda/src/looper/handler.py
git commit -m "feat(lambda): structured logs, traces and job metrics via Powertools

Refs #287

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 2: Tracing, log groups, queries and dashboard in Terraform

**Files:**
- Modify: `infra/main/environments.tf` (both Lambda resources; new observability section)
- Modify: `infra/main/shared.tf` (X-Ray policy attachment)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `local.looper_function` and `aws_sqs_queue.looper_jobs_dlq` (phase 1); metric and log field names from Task 1.
- Produces: `aws_cloudwatch_log_group.looper[env]` — phase 3's plan relies on these existing.

- [ ] **Step 1: Check which log groups exist**

Run: `MSYS_NO_PATHCONV=1 aws logs describe-log-groups --log-group-name-prefix /aws/lambda/bgm-looper-processor --query "logGroups[].[logGroupName,retentionInDays]" --output text --profile personal --region us-east-1`

(`MSYS_NO_PATHCONV=1`: Git Bash otherwise rewrites the leading-`/` prefix into a Windows path and the query matches nothing, which reads as "no log groups exist".)
Expected: up to three names, retention `None`. Note any that are missing; Step 3's import map leaves them out.

- [ ] **Step 2: Turn on tracing and set `LOOPER_ENV`.** In `resource "aws_lambda_function" "looper"`, add after `memory_size = 1024` and extend the existing `environment` block:

```hcl
  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      JOBS_TABLE_NAME = aws_dynamodb_table.looper_jobs["main"].name
      LOOPER_ENV      = "main"
    }
  }
```

In `resource "aws_lambda_function" "looper_env"`, the same with `aws_dynamodb_table.looper_jobs[each.key].name` and `LOOPER_ENV = each.key`.

In `infra/main/shared.tf`, after `resource "aws_iam_role_policy_attachment" "lambda_basic"`:

```hcl
# Lets active tracing send segments to X-Ray.
resource "aws_iam_role_policy_attachment" "lambda_xray" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}
```

- [ ] **Step 3: Add the observability section** to `infra/main/environments.tf`, after the phase 1 job resources:

```hcl
# --- Looper observability (spec 2026-09-28-looper-observability-design.md) ---

# Lambda created these implicitly on first invoke, with no expiry. Imported rather
# than recreated so their history survives. Leave out any env whose group did not
# exist at import time; Terraform creates it instead.
import {
  for_each = {
    main  = "bgm-looper-processor"
    dev   = "bgm-looper-processor-dev"
    stage = "bgm-looper-processor-stage"
  }
  to = aws_cloudwatch_log_group.looper[each.key]
  id = "/aws/lambda/${each.value}"
}

resource "aws_cloudwatch_log_group" "looper" {
  for_each          = local.looper_function
  name              = "/aws/lambda/${each.value.function_name}"
  retention_in_days = 14
}

locals {
  looper_log_groups = [for g in aws_cloudwatch_log_group.looper : g.name]
}

resource "aws_cloudwatch_query_definition" "looper_failed_jobs" {
  name            = "Looper/failed jobs"
  log_group_names = local.looper_log_groups
  query_string    = <<-EOT
    fields @timestamp, job_key, message, @logStream
    | filter level = "ERROR"
    | sort @timestamp desc
    | limit 50
  EOT
}

resource "aws_cloudwatch_query_definition" "looper_job_duration" {
  name            = "Looper/job duration"
  log_group_names = local.looper_log_groups
  query_string    = <<-EOT
    filter message = "job finished"
    | stats avg(duration_ms) as avg_ms, pct(duration_ms, 95) as p95_ms, max(duration_ms) as max_ms, count(*) as jobs by bin(1d)
  EOT
}

resource "aws_cloudwatch_query_definition" "looper_cold_starts" {
  name            = "Looper/cold starts"
  log_group_names = local.looper_log_groups
  query_string    = <<-EOT
    filter cold_start = 1
    | stats count(*) as cold_starts by function_name, bin(1d)
  EOT
}

resource "aws_cloudwatch_dashboard" "looper" {
  dashboard_name = "bgm-looper"
  dashboard_body = jsonencode({
    widgets = concat(
      [for i, env in ["main", "dev", "stage"] : {
        type   = "metric"
        x      = 0
        y      = i * 6
        width  = 12
        height = 6
        properties = {
          title  = "Lambda (${env})"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", local.looper_function[env].function_name],
            [".", "Errors", ".", "."],
            [".", "Duration", ".", ".", { stat = "p95", yAxis = "right" }],
          ]
        }
      }],
      [for i, env in ["main", "dev", "stage"] : {
        type   = "metric"
        x      = 12
        y      = i * 6
        width  = 12
        height = 6
        properties = {
          title  = "Jobs (${env})"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            ["BgmLooper", "JobSucceeded", "service", "looper", "environment", env],
            [".", "JobRejected", ".", ".", ".", "."],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.looper_jobs_dlq[env].name, { stat = "Maximum", label = "DLQ depth" }],
          ]
        }
      }],
      [{
        type   = "log"
        x      = 0
        y      = 18
        width  = 24
        height = 6
        properties = {
          title  = "Failed jobs (all envs)"
          region = var.aws_region
          query  = "SOURCE ${join(" | SOURCE ", [for n in local.looper_log_groups : "'${n}'"])} | fields @timestamp, job_key, message | filter level = \"ERROR\" | sort @timestamp desc | limit 20"
          view   = "table"
        }
      }]
    )
  })
}
```

Remove any env from the `import` block's map that Step 1 showed missing.

- [ ] **Step 4: Validate and plan**

Run: `cd infra/main && terraform fmt && terraform validate && terraform plan -var-file=terraform.tfvars`
Expected: 3 (or fewer) log groups **imported** and updated in place (retention), not created; 3 query definitions, 1 dashboard, 1 policy attachment created; both Lambda resources updated in place (tracing, env). No destroys. If a log group shows as "create" while Step 1 listed it, the import `id` is wrong — stop and fix.

- [ ] **Step 5: CHANGELOG** under `## [Unreleased]` → `### Added`:

```markdown
- BGM Looper observability: structured JSON logs with the job key, X-Ray traces per job, `JobSucceeded`/`JobRejected` metrics per environment, 14-day log retention, three saved Logs Insights queries and a `bgm-looper` CloudWatch dashboard (#287).
```

- [ ] **Step 6: Commit, open the PR, apply, merge, deploy**

```bash
git add infra/main/environments.tf infra/main/shared.tf CHANGELOG.md
git commit -m "feat(infra): looper tracing, log retention, saved queries and dashboard

Refs #287

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/looper-observability
gh pr create --base dev --title "feat: looper observability (Powertools, X-Ray, dashboard)" --body "Phase 2 (spec 2026-09-28-looper-observability-design.md). Paste the terraform plan summary here.

Closes #287"
```

With the owner's go-ahead: `terraform apply -var-file=terraform.tfvars`, then `terraform plan` shows `No changes.`. Delete the `import` block (it has done its job; leaving it is harmless but it reads as pending work), confirm `terraform plan` still shows `No changes.`, commit that as `chore(infra): drop applied log group imports`. Merge per the `merging-a-pr` skill (this PR touches `lambda/`: merge it alone). Deploy the image to dev.

- [ ] **Step 7: Verify on dev**

1. Upload a clip on https://dev.ashutosh-pandey.com/tools/bgm-looper.
2. CloudWatch → X-Ray traces → the newest trace for `bgm-looper-processor-dev` shows subsegments for S3 `GetObject`, `## _run_pipeline`, S3 `PutObject` and DynamoDB `UpdateItem` (twice).
3. Logs Insights → Queries → run each `Looper/*` query over the last hour. `job duration` shows one job; `cold starts` shows one row if the function was cold. If `cold starts` returns nothing on a known cold start, change the filter to `filter cold_start = "true"` or `filter cold_start`, re-apply, and note which form worked in the query's comment.
4. Metrics → `BgmLooper` → `environment, service` shows `JobSucceeded` for `dev`.
5. The `bgm-looper` dashboard renders all rows.

Repeat 1–4 on stage and main after each promotion and manual deploy.
