# Looper Async Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the looper's synchronous Lambda invoke with S3 event → SQS → Lambda processing, a DynamoDB job-status row, and a page that polls `/api/looper/status`.

**Architecture:** An upload to `uploads/` fires an S3 `ObjectCreated` event into a per-environment SQS queue; an event source mapping feeds it to the existing DSP Lambda, which writes `processing → done/failed` to a per-environment DynamoDB table with conditional writes. The web app drops `/api/looper/process` and adds a GET status route the page polls every 2s. Rollout is four PRs so no environment's Lambda receives SQS events before its code understands them.

**Tech Stack:** Python 3.12 + boto3 + pytest/moto (Lambda); Next.js 16 route handlers + `@aws-sdk/client-dynamodb` + Vitest (web); Terraform `aws` provider (infra).

**Spec:** `docs/superpowers/specs/2026-09-28-looper-async-jobs-design.md`. Issue #286, epic #285.

## Global Constraints

- Per-env resources are keyed `main`/`dev`/`stage` via `local.data_bucket_suffix`, in `infra/main/environments.tf`. Shared IAM stays in `infra/main/shared.tf`.
- Queue names: `looper-jobs-<env>` and `looper-jobs-dlq-<env>`. Table name: `looper-jobs-<env>`. All three envs use the suffix, including `main`.
- SQS: visibility timeout 360s; `maxReceiveCount = 3`; DLQ retention 1209600s (14 days).
- Event source mapping: `batch_size = 1`, `scaling_config.maximum_concurrency = 2`.
- S3 notification: `s3:ObjectCreated:*`, `filter_prefix = "uploads/"`. Never without the prefix — the buckets also hold `resume/` and `news-desk/` data.
- DynamoDB: partition key `jobKey` (S), `PAY_PER_REQUEST`, TTL attribute `expiresAt` = now + 86400s.
- Status writes: `UpdateItem` with `attribute_not_exists(#status) OR #status = :processing`.
- Polling: every 2000ms; fail after 60000ms still `queued`; fail after 120000ms overall.
- Env var name for the table: `JOBS_TABLE_NAME`, on the Lambda and on Vercel.
- Every manual `aws` CLI call: `--profile personal --region us-east-1`.
- Every `infra/` PR: `terraform plan -var-file=terraform.tfvars` from `infra/main/` against real state before merge.
- Merge `lambda/`-touching PRs one at a time. Feature PRs into `dev` merge with `gh pr merge <N> --squash --delete-branch`, after following the `merging-a-pr` skill.
- Commit messages end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.
- No mannered prose in docs, CHANGELOG entries, commits or PR descriptions.

## Review Focus

- **A filename whose extension has a space or `+`** (`keyForUpload("take.final mix")` → `uploads/<uuid>.final mix`): S3 URL-encodes the key in the event, so the Lambda must decode it (Task 1) and the status route must accept it (Task 5), or the job never finishes from the page's point of view.
- **A redelivery after a transient failure** (row already `processing`): must process normally, not be skipped as a duplicate. Test in Task 1.
- **The browser's S3 PUT failing** (CORS, expired URL): today the page ignores the PUT response and the synchronous `/process` failed fast. With polling it would wait 60s for a job that can never start. Task 6 checks `res.ok` on the PUT.
- **A row with an unrecognised `status`** (a future writer, a hand-edited row): `getJobStatus` throws, the route 500s, and the page shows "Processing failed" instead of polling forever. Test in Task 4.
- **An upload with no extension** (`uploads/<uuid>`): valid for `keyForUpload` today, so `isUploadKey` must accept it. Test in Task 4.

## PR order and prerequisites

| PR | Branch | Tasks | Merge only after |
|---|---|---|---|
| 1 | `feat/looper-async-lambda` (carries spec + plan) | 1 | — |
| 2 | `feat/looper-async-infra` | 2, 3 | PR 1 merged into `dev` and dev's `deploy` job green |
| 3 | `feat/looper-async-web` | 4, 5, 6, 7 | PR 1 promoted to `main` (so all three Lambdas accept SQS events) |
| 4 | `chore/looper-async-cleanup` | 8, 9 | PR 3 promoted to `main` (so nothing calls `/process` or invokes the Lambda directly) |

Each PR body says `Refs #286`; PR 4 says `Closes #286`.

---

## PR 1 — Lambda accepts SQS events

### Task 1: Dual-mode handler with job-status writes

**Files:**
- Modify: `lambda/src/looper/handler.py` (whole file)
- Modify: `lambda/tests/test_handler.py` (keep the existing test, add new ones)

**Interfaces:**
- Consumes: `looper.pipeline.process(input_path, output_path) -> dict` (unchanged).
- Produces: DynamoDB rows as in spec §5 — `jobKey`, `status`, `outputKey`, `result` (the dict `process()` returns, snake_case, numbers as `Decimal`), `error`, `updatedAt`, `expiresAt`. Reads env var `JOBS_TABLE_NAME` at call time, only on the SQS path, so the direct-invoke path works before Terraform sets it. `FAILED_MESSAGE` is the string the page shows for a permanent failure.

- [ ] **Step 1: Write the failing tests**

Append to `lambda/tests/test_handler.py` (keep the existing test and imports; add these imports at the top):

```python
import json
import time
from decimal import Decimal

import pytest
from botocore.exceptions import ClientError
```

```python
BUCKET = "test-bucket"
JOBS_TABLE = "looper-jobs-test"
UPLOAD_KEY = "uploads/0b7e6c1e-2f55-4f7c-9a55-1f2b3c4d5e6f.wav"


@pytest.fixture
def aws(monkeypatch, tmp_path):
    monkeypatch.setattr(handler_module, "TMP_DIR", str(tmp_path))
    monkeypatch.setenv("JOBS_TABLE_NAME", JOBS_TABLE)
    with mock_aws():
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket=BUCKET)
        table = boto3.resource("dynamodb", region_name="us-east-1").create_table(
            TableName=JOBS_TABLE,
            KeySchema=[{"AttributeName": "jobKey", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "jobKey", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield s3, table


def sqs_event(key: str) -> dict:
    # What the event source mapping hands the function: one SQS record whose
    # body is the S3 event notification, with the key URL-encoded as S3 sends it.
    s3_event = {"Records": [{"s3": {"bucket": {"name": BUCKET}, "object": {"key": key}}}]}
    return {"Records": [{"body": json.dumps(s3_event)}]}


def fake_process(input_path, output_path, target_lufs=-14.0):
    with open(input_path, "rb") as f:
        data = f.read()
    with open(output_path, "wb") as f:
        f.write(data + b"-processed")
    return {"peaks": [0.5, 1.0], "tempo_bpm": 96.0, "loop_start_sec": None}


def test_sqs_event_processes_upload_and_records_done(aws, monkeypatch):
    s3, table = aws
    s3.put_object(Bucket=BUCKET, Key=UPLOAD_KEY, Body=b"audio")
    monkeypatch.setattr(handler_module, "process", fake_process)

    assert handler_module.handler(sqs_event(UPLOAD_KEY), None) is None

    output_key = UPLOAD_KEY.replace("uploads/", "outputs/")
    assert s3.get_object(Bucket=BUCKET, Key=output_key)["Body"].read() == b"audio-processed"
    item = table.get_item(Key={"jobKey": UPLOAD_KEY})["Item"]
    assert item["status"] == "done"
    assert item["outputKey"] == output_key
    assert item["result"] == {
        "peaks": [Decimal("0.5"), Decimal("1.0")],
        "tempo_bpm": Decimal("96.0"),
        "loop_start_sec": None,
    }
    assert abs(int(item["expiresAt"]) - (int(time.time()) + 86400)) < 60


def test_sqs_event_key_is_url_decoded(aws, monkeypatch):
    # keyForUpload keeps whatever follows the filename's last dot, spaces included.
    s3, table = aws
    key = "uploads/0b7e6c1e-2f55-4f7c-9a55-1f2b3c4d5e6f.final mix+2"
    s3.put_object(Bucket=BUCKET, Key=key, Body=b"audio")
    monkeypatch.setattr(handler_module, "process", fake_process)

    handler_module.handler(sqs_event("uploads/0b7e6c1e-2f55-4f7c-9a55-1f2b3c4d5e6f.final+mix%2B2"), None)

    assert table.get_item(Key={"jobKey": key})["Item"]["status"] == "done"


def test_s3_test_event_is_skipped(aws):
    _, table = aws
    body = {"Service": "Amazon S3", "Event": "s3:TestEvent", "Bucket": BUCKET}
    handler_module.handler({"Records": [{"body": json.dumps(body)}]}, None)
    assert table.scan()["Count"] == 0


def test_pipeline_rejection_records_failed_without_raising(aws, monkeypatch):
    s3, table = aws
    s3.put_object(Bucket=BUCKET, Key=UPLOAD_KEY, Body=b"not audio")

    def reject(input_path, output_path, target_lufs=-14.0):
        raise ValueError("could not decode")

    monkeypatch.setattr(handler_module, "process", reject)

    handler_module.handler(sqs_event(UPLOAD_KEY), None)

    item = table.get_item(Key={"jobKey": UPLOAD_KEY})["Item"]
    assert item["status"] == "failed"
    assert item["error"] == handler_module.FAILED_MESSAGE


def test_s3_error_raises_so_sqs_retries(aws, monkeypatch):
    # Nothing uploaded: the download fails, which is transient from SQS's view.
    _, table = aws
    monkeypatch.setattr(handler_module, "process", fake_process)

    with pytest.raises(ClientError):
        handler_module.handler(sqs_event(UPLOAD_KEY), None)

    assert table.get_item(Key={"jobKey": UPLOAD_KEY})["Item"]["status"] == "processing"


def test_redelivery_after_transient_failure_processes(aws, monkeypatch):
    s3, table = aws
    table.put_item(Item={"jobKey": UPLOAD_KEY, "status": "processing"})
    s3.put_object(Bucket=BUCKET, Key=UPLOAD_KEY, Body=b"audio")
    monkeypatch.setattr(handler_module, "process", fake_process)

    handler_module.handler(sqs_event(UPLOAD_KEY), None)

    assert table.get_item(Key={"jobKey": UPLOAD_KEY})["Item"]["status"] == "done"


def test_duplicate_delivery_leaves_finished_job_alone(aws, monkeypatch):
    s3, table = aws
    table.put_item(Item={"jobKey": UPLOAD_KEY, "status": "done", "outputKey": "outputs/x.wav"})
    s3.put_object(Bucket=BUCKET, Key=UPLOAD_KEY, Body=b"audio")
    calls = []
    monkeypatch.setattr(handler_module, "process", lambda *a, **k: calls.append(a) or {})

    handler_module.handler(sqs_event(UPLOAD_KEY), None)

    assert calls == []
    assert table.get_item(Key={"jobKey": UPLOAD_KEY})["Item"] == {
        "jobKey": UPLOAD_KEY,
        "status": "done",
        "outputKey": "outputs/x.wav",
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd lambda && .venv/Scripts/python -m pytest tests/test_handler.py -q`
Expected: the existing test passes; the seven new ones fail (`KeyError: 'bucket'` from the old handler, and `AttributeError: ... FAILED_MESSAGE`).

- [ ] **Step 3: Replace `lambda/src/looper/handler.py`**

```python
import json
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import unquote_plus

import boto3
from botocore.exceptions import ClientError

from looper.pipeline import process

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")

TMP_DIR = "/tmp"

# Matches the 1-day S3 expiry on uploads/ and outputs/.
JOB_TTL_SECONDS = 24 * 60 * 60

# Shown on the page as-is, so it says nothing about internals.
FAILED_MESSAGE = "This file could not be processed. It may not be a supported audio format."


def handler(event: dict, context) -> dict | None:
    # Direct invoke from /api/looper/process. Removed once no environment calls
    # that route any more (spec §7, PR 4).
    if "Records" not in event:
        return _process_direct(event)

    for record in event["Records"]:
        _process_record(record)
    return None


def _paths(input_key: str) -> tuple[str, str]:
    ext = os.path.splitext(input_key)[1]
    return os.path.join(TMP_DIR, f"input{ext}"), os.path.join(TMP_DIR, f"output{ext}")


def _process_direct(event: dict) -> dict:
    bucket = event["bucket"]
    input_key = event["input_key"]
    output_key = event["output_key"]
    input_path, output_path = _paths(input_key)

    s3.download_file(bucket, input_key, input_path)
    meta = process(input_path, output_path)
    s3.upload_file(output_path, bucket, output_key)

    return {"output_key": output_key, **meta}


def _process_record(record: dict) -> None:
    body = json.loads(record["body"])
    # S3 sends this once, when the bucket notification is created.
    if body.get("Event") == "s3:TestEvent":
        return
    for s3_record in body["Records"]:
        bucket = s3_record["s3"]["bucket"]["name"]
        # S3 URL-encodes keys in event notifications (a space arrives as "+").
        key = unquote_plus(s3_record["s3"]["object"]["key"])
        _process_upload(bucket, key)


def _process_upload(bucket: str, key: str) -> None:
    table = boto3.resource("dynamodb").Table(os.environ["JOBS_TABLE_NAME"])
    output_key = "outputs/" + key.removeprefix("uploads/")

    try:
        _write_status(table, key, "processing")
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        logger.info("Skipping %s: job already finished (duplicate delivery)", key)
        return

    # Errors around process() are transient: raising hands the message back to
    # SQS, which retries it and moves it to the DLQ after 3 receives.
    input_path, output_path = _paths(key)
    s3.download_file(bucket, key, input_path)

    # Errors inside process() are permanent: retrying bad audio gives the same
    # result, so record the failure and let SQS delete the message.
    try:
        meta = process(input_path, output_path)
    except Exception:
        logger.exception("Pipeline rejected %s", key)
        _write_status(table, key, "failed", error=FAILED_MESSAGE)
        return

    s3.upload_file(output_path, bucket, output_key)
    _write_status(table, key, "done", outputKey=output_key, result=_to_dynamo(meta))


def _write_status(table, job_key: str, status: str, **fields) -> None:
    now = datetime.now(timezone.utc)
    values = {
        "status": status,
        "updatedAt": now.isoformat(),
        "expiresAt": int(now.timestamp()) + JOB_TTL_SECONDS,
        **fields,
    }
    # A finished row never changes, so a duplicate delivery cannot move a
    # done/failed job back to processing. "status" is a DynamoDB reserved word,
    # hence the #name placeholders.
    table.update_item(
        Key={"jobKey": job_key},
        UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in values),
        ConditionExpression="attribute_not_exists(#status) OR #status = :processing",
        ExpressionAttributeNames={f"#{k}": k for k in values},
        ExpressionAttributeValues={
            **{f":{k}": v for k, v in values.items()},
            ":processing": "processing",
        },
    )


def _to_dynamo(meta: dict) -> dict:
    # boto3's DynamoDB serializer rejects Python floats.
    return json.loads(json.dumps(meta), parse_float=Decimal)
```

- [ ] **Step 4: Run the full Lambda suite**

Run: `cd lambda && .venv/Scripts/python -m pytest -q`
Expected: all tests pass, including the original direct-invoke test.

- [ ] **Step 5: Commit and open PR 1**

```bash
git add lambda/src/looper/handler.py lambda/tests/test_handler.py docs/superpowers/plans/2026-09-28-looper-async-jobs.md
git commit -m "feat(lambda): accept SQS-wrapped S3 events and record job status

The direct-invoke path is unchanged, so this deploys with no behaviour
change. The SQS path writes processing/done/failed rows to the table
named by JOBS_TABLE_NAME, with a conditional write so a duplicate
delivery cannot reopen a finished job.

Refs #286

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/looper-async-lambda
gh pr create --base dev --title "feat(lambda): accept SQS events and record job status" --body "Phase 1, PR 1 of 4 (spec §7). Carries the design spec and plan. The handler accepts both the direct-invoke payload and SQS-wrapped S3 events; direct invokes behave exactly as today.

Refs #286"
```

Merge per the `merging-a-pr` skill. Confirm dev's `deploy` job ran and passed before starting PR 2.

---

## PR 2 — Queues, table, alarm; dev only

Branch `feat/looper-async-infra` from `dev` after PR 1 merges.

### Task 2: Per-environment queues, table, alarm and the rollout switch

**Files:**
- Modify: `infra/main/variables.tf` (append)
- Modify: `infra/main/environments.tf` (new section after the Lambda resources; `environment` blocks on both Lambda resources)

**Interfaces:**
- Produces: `aws_sqs_queue.looper_jobs[env]`, `aws_sqs_queue.looper_jobs_dlq[env]`, `aws_dynamodb_table.looper_jobs[env]`, `local.looper_function[env]` (the Lambda resource for each env), `var.looper_async_envs`. Task 3 grants IAM on the queue and table ARNs.

- [ ] **Step 1: Add the variable to `infra/main/variables.tf`**

```hcl
# Environments whose uploads/ events reach their Lambda through SQS. Exists only for
# the phase 1 rollout: an environment joins once its Lambda runs code that accepts SQS
# events, and the variable is removed when all three have (spec §7).
variable "looper_async_envs" {
  type    = list(string)
  default = ["dev"]
}
```

- [ ] **Step 2: Add the job resources to `infra/main/environments.tf`**, directly after `resource "aws_lambda_function" "looper_env"`:

```hcl
# --- Async looper jobs (spec 2026-09-28-looper-async-jobs-design.md) ---
# uploads/ ObjectCreated -> SQS -> Lambda, with job status in DynamoDB. The queues,
# DLQs, tables and alarms exist for all three envs; the S3 notification and the event
# source mapping only for envs in var.looper_async_envs.

locals {
  looper_function = {
    main  = aws_lambda_function.looper
    dev   = aws_lambda_function.looper_env["dev"]
    stage = aws_lambda_function.looper_env["stage"]
  }
}

resource "aws_sqs_queue" "looper_jobs_dlq" {
  for_each                  = local.data_bucket_suffix
  name                      = "looper-jobs-dlq-${each.key}"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "looper_jobs" {
  for_each = local.data_bucket_suffix
  name     = "looper-jobs-${each.key}"
  # 6x the Lambda's 60s timeout, AWS's recommended ratio, so a message is not handed
  # to a second invocation while the first is still working on it.
  visibility_timeout_seconds = 360
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.looper_jobs_dlq[each.key].arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue_policy" "looper_jobs" {
  for_each  = aws_sqs_queue.looper_jobs
  queue_url = each.value.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowOwnBucketEvents"
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = each.value.arn
      Condition = {
        ArnEquals    = { "aws:SourceArn" = aws_s3_bucket.data[each.key].arn }
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

resource "aws_dynamodb_table" "looper_jobs" {
  for_each     = local.data_bucket_suffix
  name         = "looper-jobs-${each.key}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobKey"

  attribute {
    name = "jobKey"
    type = "S"
  }

  # Rows expire with the S3 objects they describe (1 day).
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# A message in a DLQ means a job failed 3 times for a transient reason. Three more
# alarms, still inside CloudWatch's 10-alarm free tier.
resource "aws_cloudwatch_metric_alarm" "looper_jobs_dlq" {
  for_each = aws_sqs_queue.looper_jobs_dlq

  alarm_name          = "${each.value.name}-not-empty"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.value.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
  ok_actions          = [aws_sns_topic.budget_alerts.arn]

  alarm_description = "A looper job failed 3 times and is in ${each.value.name}. Inspect it with aws sqs receive-message --profile personal --region us-east-1."
}

# A bucket takes one aws_s3_bucket_notification. Any future notification on these
# buckets has to be added to this resource, not a new one.
resource "aws_s3_bucket_notification" "looper_uploads" {
  for_each = toset(var.looper_async_envs)
  bucket   = aws_s3_bucket.data[each.key].id

  queue {
    queue_arn     = aws_sqs_queue.looper_jobs[each.key].arn
    events        = ["s3:ObjectCreated:*"]
    # Required: the same bucket holds resume/ and news-desk/ data.
    filter_prefix = "uploads/"
  }

  depends_on = [aws_sqs_queue_policy.looper_jobs]
}

resource "aws_lambda_event_source_mapping" "looper_jobs" {
  for_each         = toset(var.looper_async_envs)
  event_source_arn = aws_sqs_queue.looper_jobs[each.key].arn
  function_name    = local.looper_function[each.key].arn
  batch_size       = 1

  scaling_config {
    maximum_concurrency = 2
  }

  depends_on = [aws_iam_role_policy.lambda_jobs]
}
```

- [ ] **Step 3: Give both Lambda resources the table name.** In `resource "aws_lambda_function" "looper"`, after `memory_size = 1024`:

```hcl
  environment {
    variables = {
      JOBS_TABLE_NAME = aws_dynamodb_table.looper_jobs["main"].name
    }
  }
```

In `resource "aws_lambda_function" "looper_env"`, after `memory_size = 1024`:

```hcl
  environment {
    variables = {
      JOBS_TABLE_NAME = aws_dynamodb_table.looper_jobs[each.key].name
    }
  }
```

- [ ] **Step 4: Format and validate**

Run: `cd infra/main && terraform fmt && terraform validate`
Expected: `Success! The configuration is valid.` — it will fail until Task 3 adds `aws_iam_role_policy.lambda_jobs`. Do Task 3, then validate.

### Task 3: IAM for the Lambda and Vercel, table name on Vercel

**Files:**
- Modify: `infra/main/shared.tf` (new policy after `aws_iam_role_policy.lambda_s3`; new statement in `aws_iam_role_policy.vercel`)
- Modify: `infra/main/environments.tf` (three Vercel env vars after `lambda_function_name_stage`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `aws_sqs_queue.looper_jobs`, `aws_dynamodb_table.looper_jobs` (Task 2).
- Produces: `aws_iam_role_policy.lambda_jobs`; Vercel env var `JOBS_TABLE_NAME` per env, used by Task 4's `getJobStatus`.

- [ ] **Step 1: Add the Lambda policy to `infra/main/shared.tf`**, after `resource "aws_iam_role_policy" "lambda_s3"`:

```hcl
resource "aws_iam_role_policy" "lambda_jobs" {
  name = "${var.project_name}-lambda-jobs"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # What the event source mapping needs to poll a queue on the function's behalf.
        Sid      = "ConsumeJobQueues"
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = [for q in aws_sqs_queue.looper_jobs : q.arn]
      },
      {
        Sid      = "WriteJobStatus"
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem"]
        Resource = [for t in aws_dynamodb_table.looper_jobs : t.arn]
      }
    ]
  })
}
```

- [ ] **Step 2: Let Vercel read job rows.** In `aws_iam_role_policy.vercel`, add this statement before the `InvokeProcessor` statement:

```hcl
      {
        Sid      = "ReadJobStatus"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = [for t in aws_dynamodb_table.looper_jobs : t.arn]
      },
```

- [ ] **Step 3: Add the Vercel env vars** to `infra/main/environments.tf`, after `resource "vercel_project_environment_variable" "lambda_function_name_stage"`:

```hcl
resource "vercel_project_environment_variable" "jobs_table_production" {
  project_id = vercel_project.looper.id
  key        = "JOBS_TABLE_NAME"
  value      = aws_dynamodb_table.looper_jobs["main"].name
  target     = ["production"]
  sensitive  = false
}

resource "vercel_project_environment_variable" "jobs_table_preview" {
  project_id = vercel_project.looper.id
  key        = "JOBS_TABLE_NAME"
  value      = aws_dynamodb_table.looper_jobs["dev"].name
  target     = ["preview"]
  sensitive  = false
}

resource "vercel_project_environment_variable" "jobs_table_stage" {
  project_id = vercel_project.looper.id
  key        = "JOBS_TABLE_NAME"
  value      = aws_dynamodb_table.looper_jobs["stage"].name
  target     = ["preview"]
  git_branch = "stage"
  sensitive  = false
}
```

Check the three existing `s3_bucket_*` resources for any attribute not shown here (e.g. `sensitive`) and match them exactly.

- [ ] **Step 4: Validate and plan against real state**

Run: `cd infra/main && terraform fmt && terraform validate && terraform plan -var-file=terraform.tfvars`
Expected: validate succeeds. Plan adds: 3 SQS queues, 3 DLQs, 3 queue policies, 3 tables, 3 alarms, 1 bucket notification (`dev`), 1 event source mapping (`dev`), `lambda_jobs` policy, 3 Vercel env vars; changes in place: both Lambda resources (environment) and `vercel` policy. **No destroys, no replacements.** Stop and investigate if anything is replaced.

- [ ] **Step 5: Add a CHANGELOG entry** under `## [Unreleased]` → `### Added`:

```markdown
- BGM Looper job infrastructure: per-environment SQS queues with dead-letter queues, DynamoDB job-status tables and DLQ alarms. On `dev`, an upload now also triggers processing through SQS; the page still uses the synchronous route until the web change lands (#286).
```

- [ ] **Step 6: Commit, open PR 2, apply after merge**

```bash
git add infra/main/variables.tf infra/main/environments.tf infra/main/shared.tf CHANGELOG.md
git commit -m "feat(infra): add looper job queues, tables and DLQ alarms

S3 notification and SQS event source mapping are enabled for dev only,
via looper_async_envs.

Refs #286

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/looper-async-infra
gh pr create --base dev --title "feat(infra): looper job queues, tables and DLQ alarms" --body "Phase 1, PR 2 of 4 (spec §4, §7). Paste the terraform plan summary here.

Refs #286"
```

After merge: `cd infra/main && terraform apply -var-file=terraform.tfvars`, confirm the same resource counts as the plan.

- [ ] **Step 7: Verify on dev by hand**

1. Upload a clip on https://dev.ashutosh-pandey.com/tools/bgm-looper. The page still works through `/process`.
2. `aws dynamodb get-item --table-name looper-jobs-dev --key '{"jobKey":{"S":"<key from the network tab>"}}' --profile personal --region us-east-1` returns `status = done`.
3. DLQ path: `aws sqs send-message --queue-url <looper-jobs-dev url> --message-body '{"Records":[{"s3":{"bucket":{"name":"portfolio-data-dev-223376380711"},"object":{"key":"uploads/does-not-exist.wav"}}}]}' --profile personal --region us-east-1`. The download fails 3 times (≈18 min at 360s visibility), the message lands in `looper-jobs-dlq-dev`, and the alarm email arrives.
4. Purge the DLQ afterwards: `aws sqs purge-queue --queue-url <dlq url> --profile personal --region us-east-1`, and delete the `uploads/does-not-exist.wav` row if one was written.

---

## PR 3 — Page polls job status

Branch `feat/looper-async-web` from `dev`. **Do not merge until PR 1 is on `main`** (check `git log origin/main --oneline -- lambda/src/looper/handler.py`).

### Task 4: `getJobStatus` and `isUploadKey`

**Files:**
- Modify: `web/package.json`, `web/package-lock.json` (add `@aws-sdk/client-dynamodb`, `@aws-sdk/util-dynamodb`)
- Modify: `web/lib/aws.ts` (add `getDynamoClient`)
- Modify: `web/lib/looper.ts` (export `LambdaResult`)
- Create: `web/lib/looper-jobs.ts`
- Test: `web/lib/looper-jobs.test.ts`

`getJobStatus` lives in its own server-only file, not in `lib/looper.ts` as the spec says: the page imports runtime values from `lib/looper.ts` (Task 6), and pulling the AWS SDK into that module would put it in the client bundle.

**Interfaces:**
- Consumes: DynamoDB rows written by Task 1; env var `JOBS_TABLE_NAME` (Task 3).
- Produces:
  - `getDynamoClient(): DynamoDBClient` in `web/lib/aws.ts`
  - `export type LambdaResult` in `web/lib/looper.ts` (already defined there, now exported)
  - `web/lib/looper-jobs.ts`:
    - `type JobStatus = { status: "queued" } | { status: "processing" } | { status: "failed"; error: string } | { status: "done"; outputKey: string; result: LambdaResult }`
    - `isUploadKey(key: unknown): key is string`
    - `getJobStatus(key: string): Promise<JobStatus>`

- [ ] **Step 1: Install the SDK packages**

Run: `cd web && npm install @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb`

- [ ] **Step 2: Write the failing tests** in `web/lib/looper-jobs.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { marshall } from "@aws-sdk/util-dynamodb";
import { getJobStatus, isUploadKey } from "./looper-jobs";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/aws", () => ({ getDynamoClient: () => ({ send }) }));

const KEY = "uploads/0b7e6c1e-2f55-4f7c-9a55-1f2b3c4d5e6f.wav";

describe("isUploadKey", () => {
  it.each([
    KEY,
    "uploads/0b7e6c1e-2f55-4f7c-9a55-1f2b3c4d5e6f",
    "uploads/0b7e6c1e-2f55-4f7c-9a55-1f2b3c4d5e6f.final mix",
  ])("accepts %s, a shape keyForUpload produces", (key) => {
    expect(isUploadKey(key)).toBe(true);
  });

  it.each([
    null,
    "",
    "outputs/0b7e6c1e-2f55-4f7c-9a55-1f2b3c4d5e6f.wav",
    "resume/current.json",
    "uploads/not-a-uuid.wav",
    "uploads/0b7e6c1e-2f55-4f7c-9a55-1f2b3c4d5e6f.wav/../x",
  ])("rejects %s", (key) => {
    expect(isUploadKey(key)).toBe(false);
  });
});

describe("getJobStatus", () => {
  beforeEach(() => {
    send.mockReset();
    process.env.JOBS_TABLE_NAME = "looper-jobs-test";
  });

  it("reads the row by key from the configured table", async () => {
    send.mockResolvedValue({});
    await getJobStatus(KEY);
    const input = send.mock.calls[0][0].input;
    expect(input.TableName).toBe("looper-jobs-test");
    expect(input.Key).toEqual({ jobKey: { S: KEY } });
  });

  it("reports a job with no row yet as queued", async () => {
    send.mockResolvedValue({});
    expect(await getJobStatus(KEY)).toEqual({ status: "queued" });
  });

  it("reports processing", async () => {
    send.mockResolvedValue({ Item: marshall({ jobKey: KEY, status: "processing" }) });
    expect(await getJobStatus(KEY)).toEqual({ status: "processing" });
  });

  it("reports failed with the reason the Lambda recorded", async () => {
    send.mockResolvedValue({
      Item: marshall({ jobKey: KEY, status: "failed", error: "Not audio." }),
    });
    expect(await getJobStatus(KEY)).toEqual({ status: "failed", error: "Not audio." });
  });

  it("reports done with the output key and the pipeline's metadata", async () => {
    send.mockResolvedValue({
      Item: marshall({
        jobKey: KEY,
        status: "done",
        outputKey: "outputs/x.wav",
        result: { peaks: [0.5, 1], tempo_bpm: 96, loop_start_sec: null },
      }),
    });
    expect(await getJobStatus(KEY)).toEqual({
      status: "done",
      outputKey: "outputs/x.wav",
      result: { peaks: [0.5, 1], tempo_bpm: 96, loop_start_sec: null },
    });
  });

  it("throws on a status it does not know rather than reporting a guess", async () => {
    send.mockResolvedValue({ Item: marshall({ jobKey: KEY, status: "paused" }) });
    await expect(getJobStatus(KEY)).rejects.toThrow("paused");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx vitest run lib/looper-jobs.test.ts`
Expected: FAIL — cannot resolve `./looper-jobs`.

- [ ] **Step 4: Implement**

In `web/lib/aws.ts`, add the import beside the S3 imports and the function after `getS3Client`:

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
```

```ts
export function getDynamoClient(): DynamoDBClient {
  return new DynamoDBClient({ region: process.env.APP_AWS_REGION!, ...awsCredentials() });
}
```

In `web/lib/looper.ts`, change `type LambdaResult = Partial<{` to `export type LambdaResult = Partial<{`.

Create `web/lib/looper-jobs.ts`:

```ts
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { getDynamoClient } from "@/lib/aws";
import type { LambdaResult } from "@/lib/looper";

/** A looper job as the Lambda records it in DynamoDB (spec §5). Server-only:
 * kept out of lib/looper.ts so the AWS SDK stays out of the page's bundle. */
export type JobStatus =
  | { status: "queued" }
  | { status: "processing" }
  | { status: "failed"; error: string }
  | { status: "done"; outputKey: string; result: LambdaResult };

// The shape keyForUpload produces: a v4 UUID plus whatever followed the
// filename's last dot, which can include spaces. No slash after the prefix.
const UPLOAD_KEY =
  /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[^/]*)?$/;

export function isUploadKey(key: unknown): key is string {
  return typeof key === "string" && UPLOAD_KEY.test(key);
}

export async function getJobStatus(key: string): Promise<JobStatus> {
  const res = await getDynamoClient().send(
    new GetItemCommand({
      TableName: process.env.JOBS_TABLE_NAME!,
      Key: { jobKey: { S: key } },
      ConsistentRead: true,
    }),
  );
  // The Lambda writes the first row when it starts; until then the upload is
  // waiting in SQS.
  if (!res.Item) return { status: "queued" };

  const item = unmarshall(res.Item);
  switch (item.status) {
    case "processing":
      return { status: "processing" };
    case "failed":
      return { status: "failed", error: item.error };
    case "done":
      return { status: "done", outputKey: item.outputKey, result: item.result };
    default:
      throw new Error(`Unknown job status: ${item.status}`);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx vitest run lib/looper-jobs.test.ts lib/looper.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/lib/aws.ts web/lib/looper.ts web/lib/looper-jobs.ts web/lib/looper-jobs.test.ts
git commit -m "feat(web): read looper job status from DynamoDB

Refs #286

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 5: `GET /api/looper/status`

**Files:**
- Create: `web/app/api/looper/status/route.ts`
- Test: `web/app/api/looper/status/route.test.ts`

**Interfaces:**
- Consumes: `isUploadKey`, `getJobStatus` (Task 4); `toLoopResult` from `@/lib/looper`; `presignDownload`, `DOWNLOAD_URL_TTL_SECONDS` from `@/lib/aws`.
- Produces: `GET /api/looper/status?key=<upload key>` →
  - 400 `{ error: "invalid key" }` when `isUploadKey` fails
  - 200 `{ status: "queued" }` | `{ status: "processing" }` | `{ status: "failed", error }`
  - 200 `{ status: "done", result: LoopResult }`
  - The page (Task 6) reads exactly these bodies.

Before writing the route, read the route-handler guide under `web/node_modules/next/dist/docs/` for how Next 16 caches GET handlers. The route sets `dynamic = "force-dynamic"` regardless, since a cached status would never change.

- [ ] **Step 1: Write the failing tests** in `web/app/api/looper/status/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { getJobStatus } from "@/lib/looper-jobs";

vi.mock("@/lib/looper-jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/looper-jobs")>()),
  getJobStatus: vi.fn(),
}));
vi.mock("@/lib/aws", () => ({
  presignDownload: vi.fn(async (key: string) => `https://s3/${key}`),
  DOWNLOAD_URL_TTL_SECONDS: 300,
}));

const KEY = "uploads/0b7e6c1e-2f55-4f7c-9a55-1f2b3c4d5e6f.final mix";

function get(key?: string) {
  const url = new URL("http://localhost/api/looper/status");
  if (key !== undefined) url.searchParams.set("key", key);
  return GET(new NextRequest(url));
}

describe("GET /api/looper/status", () => {
  beforeEach(() => vi.mocked(getJobStatus).mockReset());

  it("rejects a missing key", async () => {
    const res = await get();
    expect(res.status).toBe(400);
    expect(getJobStatus).not.toHaveBeenCalled();
  });

  it("rejects a key outside uploads/", async () => {
    const res = await get("resume/current.json");
    expect(res.status).toBe(400);
    expect(getJobStatus).not.toHaveBeenCalled();
  });

  it("accepts a key whose extension has a space", async () => {
    vi.mocked(getJobStatus).mockResolvedValue({ status: "queued" });
    const res = await get(KEY);
    expect(res.status).toBe(200);
    expect(getJobStatus).toHaveBeenCalledWith(KEY);
  });

  it("passes queued and processing through", async () => {
    vi.mocked(getJobStatus).mockResolvedValue({ status: "processing" });
    expect(await (await get(KEY)).json()).toEqual({ status: "processing" });
  });

  it("passes the failure reason through", async () => {
    vi.mocked(getJobStatus).mockResolvedValue({ status: "failed", error: "Not audio." });
    expect(await (await get(KEY)).json()).toEqual({ status: "failed", error: "Not audio." });
  });

  it("returns the loop with a presigned link when done", async () => {
    vi.mocked(getJobStatus).mockResolvedValue({
      status: "done",
      outputKey: "outputs/x.wav",
      result: { peaks: [0.5, 1], duration_sec: 12.5, tempo_bpm: 96 },
    });
    const body = await (await get(KEY)).json();
    expect(body.status).toBe("done");
    expect(body.result.downloadUrl).toBe("https://s3/outputs/x.wav");
    expect(body.result.peaks).toEqual([0.5, 1]);
    expect(body.result.tempoBpm).toBe(96);
    expect(body.result.hasMetadata).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run app/api/looper/status`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement** `web/app/api/looper/status/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { presignDownload, DOWNLOAD_URL_TTL_SECONDS } from "@/lib/aws";
import { toLoopResult } from "@/lib/looper";
import { getJobStatus, isUploadKey } from "@/lib/looper-jobs";

// A status is only useful fresh.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  // Also stops a caller reading rows for keys the page never issued.
  if (!isUploadKey(key)) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }

  const job = await getJobStatus(key);
  if (job.status !== "done") return NextResponse.json(job);

  const downloadUrl = await presignDownload(job.outputKey);
  const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString();
  return NextResponse.json({
    status: "done",
    result: toLoopResult(job.result, downloadUrl, expiresAt),
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run app/api/looper/status`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/looper/status
git commit -m "feat(web): add GET /api/looper/status

Refs #286

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 6: Poll decision function and page switch-over

**Files:**
- Modify: `web/lib/looper.ts` (add poll constants, types and `nextPollAction`; update the `LoopResult` doc comment)
- Modify: `web/lib/looper.test.ts` (add `nextPollAction` tests)
- Modify: `web/app/tools/bgm-looper/page.tsx:8-11, 71-147, 260-287`
- Modify: `web/app/tools/bgm-looper/page.test.tsx`
- Delete: `web/app/api/looper/process/route.ts`
- Modify: `web/lib/looper.ts`, `web/lib/looper.test.ts` (remove `parseLambdaPayload`, now unused)
- Modify: `web/package.json`, `web/package-lock.json` (remove `@aws-sdk/client-lambda`, now unused)

**Interfaces:**
- Consumes: the status route's response bodies (Task 5).
- Produces in `web/lib/looper.ts`:
  - `POLL_INTERVAL_MS = 2_000`, `QUEUED_TIMEOUT_MS = 60_000`, `TOTAL_TIMEOUT_MS = 120_000`
  - `type JobStatusResponse = { status: "queued" } | { status: "processing" } | { status: "failed"; error: string } | { status: "done"; result: LoopResult }`
  - `type PollAction = { kind: "wait"; ms: number } | { kind: "done"; result: LoopResult } | { kind: "failed"; error: string }`
  - `nextPollAction(elapsedMs: number, job: JobStatusResponse): PollAction`

- [ ] **Step 1: Write the failing `nextPollAction` tests.** In `web/lib/looper.test.ts`, change the import to `import { nextPollAction, POLL_INTERVAL_MS, toLoopResult } from "./looper";`, delete the whole `describe("parseLambdaPayload", …)` block, and append:

```ts
describe("nextPollAction", () => {
  const result = toLoopResult({ peaks: [1] }, "https://s3/x", "2026-09-28T00:00:00.000Z");

  it("waits and polls again while queued or processing", () => {
    expect(nextPollAction(0, { status: "queued" })).toEqual({ kind: "wait", ms: POLL_INTERVAL_MS });
    expect(nextPollAction(90_000, { status: "processing" })).toEqual({
      kind: "wait",
      ms: POLL_INTERVAL_MS,
    });
  });

  it("stops with the loop when done", () => {
    expect(nextPollAction(4_000, { status: "done", result })).toEqual({ kind: "done", result });
  });

  it("stops with the recorded reason when failed", () => {
    expect(nextPollAction(4_000, { status: "failed", error: "Not audio." })).toEqual({
      kind: "failed",
      error: "Not audio.",
    });
  });

  it("gives up after 60s if processing never started", () => {
    expect(nextPollAction(59_999, { status: "queued" }).kind).toBe("wait");
    expect(nextPollAction(60_000, { status: "queued" })).toEqual({
      kind: "failed",
      error: "Processing never started. Try again.",
    });
  });

  it("gives up after 120s overall", () => {
    expect(nextPollAction(119_999, { status: "processing" }).kind).toBe("wait");
    expect(nextPollAction(120_000, { status: "processing" })).toEqual({
      kind: "failed",
      error: "Processing timed out. Try again.",
    });
  });

  it("still takes a result that arrives after the deadline", () => {
    expect(nextPollAction(125_000, { status: "done", result }).kind).toBe("done");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run lib/looper.test.ts`
Expected: FAIL — `nextPollAction` is not exported.

- [ ] **Step 3: Implement in `web/lib/looper.ts`.** Replace the `LoopResult` doc comment's first line with `/** What the tool page gets back from /api/looper/status once a job is done:`, delete the whole `parseLambdaPayload` function and its comment, and append:

```ts
export const POLL_INTERVAL_MS = 2_000;
/** No row after this long means the S3 event never reached the Lambda. */
export const QUEUED_TIMEOUT_MS = 60_000;
/** Covers a job stuck at processing, including one SQS has sent to the DLQ. */
export const TOTAL_TIMEOUT_MS = 120_000;

/** The bodies /api/looper/status answers with. */
export type JobStatusResponse =
  | { status: "queued" }
  | { status: "processing" }
  | { status: "failed"; error: string }
  | { status: "done"; result: LoopResult };

export type PollAction =
  | { kind: "wait"; ms: number }
  | { kind: "done"; result: LoopResult }
  | { kind: "failed"; error: string };

/** What the page does after each status response. Pure, so the timeouts are
 * tested here rather than by waiting two minutes in a component test. */
export function nextPollAction(elapsedMs: number, job: JobStatusResponse): PollAction {
  if (job.status === "done") return { kind: "done", result: job.result };
  if (job.status === "failed") return { kind: "failed", error: job.error };
  if (job.status === "queued" && elapsedMs >= QUEUED_TIMEOUT_MS) {
    return { kind: "failed", error: "Processing never started. Try again." };
  }
  if (elapsedMs >= TOTAL_TIMEOUT_MS) {
    return { kind: "failed", error: "Processing timed out. Try again." };
  }
  return { kind: "wait", ms: POLL_INTERVAL_MS };
}
```

Run: `cd web && npx vitest run lib/looper.test.ts` — Expected: PASS.

- [ ] **Step 4: Update the page tests first.** In `web/app/tools/bgm-looper/page.test.tsx`:

Change the imports:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import Home from "./page";
import { POLL_INTERVAL_MS, toLoopResult } from "../../../lib/looper";
```

Replace `mockFetchSequence` with a version whose third response is a status body:

```ts
const UPLOAD = {
  ok: true,
  json: async () => ({ key: "uploads/abc.mp3", uploadUrl: "https://s3/upload" }),
};

function statusResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

function mockFetchSequence(result: unknown = RESULT) {
  return vi
    .fn()
    .mockResolvedValueOnce(UPLOAD)
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce(statusResponse({ status: "done", result }));
}
```

Add after the existing `beforeEach`:

```ts
  afterEach(() => {
    vi.useRealTimers();
  });
```

In the two tests that build their own sequence (`"shows an error message when processing fails"` and `"offers the failed file again after an error"`), replace the first `.mockResolvedValueOnce({ ok: true, json: async () => ({ key: …, uploadUrl: … }) })` with `.mockResolvedValueOnce(UPLOAD)`. Their third response stays `{ ok: false }` — a non-OK status route.

Append these tests inside the `describe`:

```ts
  it("polls the status route with the upload key", async () => {
    const fetchMock = mockFetchSequence();
    vi.stubGlobal("fetch", fetchMock);
    render(<Home />);
    chooseFile();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/looper/status?key=uploads%2Fabc.mp3");
  });

  it("keeps polling while the job is queued, then shows the loop", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(UPLOAD)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(statusResponse({ status: "queued" }))
      .mockResolvedValueOnce(statusResponse({ status: "done", result: RESULT }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Home />);
    chooseFile();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByText("Waiting in the queue…")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /download/i })).toBeInTheDocument();
    });
  });

  it("shows the reason the job failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(UPLOAD)
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(
          statusResponse({ status: "failed", error: "This file could not be processed." }),
        ),
    );
    render(<Home />);
    chooseFile();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("This file could not be processed.");
  });

  it("reports a failed upload instead of waiting for a job that cannot start", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(UPLOAD)
      .mockResolvedValueOnce({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetchMock);
    render(<Home />);
    chooseFile();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Upload failed.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
```

Run: `cd web && npx vitest run app/tools/bgm-looper`
Expected: FAIL — the page still POSTs to `/api/looper/process` and has no queued copy.

If `waitFor` hangs under fake timers in the queued test, that is RTL not detecting Vitest's fake timers; `shouldAdvanceTime: true` is what prevents it. Do not switch the other tests to fake timers.

- [ ] **Step 5: Switch the page.** In `web/app/tools/bgm-looper/page.tsx`:

Replace line 6 and the comment on lines 10-11:

```ts
import {
  nextPollAction,
  type JobStatusResponse,
  type LoopResult,
} from "../../../lib/looper";
```

```ts
// The four steps the page can honestly report. Server-side work is one SQS job
// the page polls, so "processing" is a single step rather than a fake sub-progress.
```

Add beside the other state (after `expiresIn`):

```ts
  // Which half of "processing" the job is in, from the status route.
  const [jobState, setJobState] = useState<"queued" | "processing">("queued");
```

Replace lines 125-142 (the S3 PUT through `setStatus("done")`) with:

```ts
      // Checked because a failed PUT means no S3 event and so no job: without
      // this the page would poll for a minute before saying anything.
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        body: picked,
        headers: { "Content-Type": picked.type },
      });
      if (!putRes.ok) throw new Error("Upload failed.");

      setStatus("processing");
      setJobState("queued");
      const started = Date.now();
      let loop: LoopResult;
      for (;;) {
        const statusRes = await fetch(
          `/api/looper/status?key=${encodeURIComponent(key)}`,
        );
        if (!statusRes.ok) throw new Error("Processing failed");
        const job: JobStatusResponse = await statusRes.json();
        const action = nextPollAction(Date.now() - started, job);
        if (action.kind === "done") {
          loop = action.result;
          break;
        }
        if (action.kind === "failed") throw new Error(action.error);
        if (job.status === "processing") setJobState("processing");
        await new Promise((resolve) => setTimeout(resolve, action.ms));
      }

      setResult(loop);
      if (loop.peaks.length > 0) setPeaks(loop.peaks);
      setStatus("done");
```

The file input is `disabled={busy}` (line 486), so a second run cannot start while this loop is polling; no cancellation is needed.

Replace the busy-state heading (lines 266-270):

```tsx
                    {status === "decoding"
                      ? "Reading the waveform…"
                      : status === "uploading"
                        ? "Uploading…"
                        : jobState === "queued"
                          ? "Waiting in the queue…"
                          : "Looping the track…"}
```

Replace the second branch of the note on line 286:

```tsx
                  : "Your upload started a job on a Lambda that cold-starts occasionally — a first run can take a few seconds longer than the rest. You can leave the tab open."}
```

- [ ] **Step 6: Delete the synchronous route and the Lambda SDK**

```bash
git rm web/app/api/looper/process/route.ts
cd web && npm uninstall @aws-sdk/client-lambda
```

- [ ] **Step 7: Run the web suite, lint and build**

Run: `cd web && npm test && npm run lint && KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build`
Expected: all pass. Grep for leftovers: `grep -rn "looper/process\|client-lambda\|parseLambdaPayload" web --include=*.ts --include=*.tsx -l | grep -v node_modules | grep -v .next` returns nothing.

- [ ] **Step 8: Commit**

```bash
git add -A web
git commit -m "feat(web): poll looper job status instead of invoking the Lambda

Deletes /api/looper/process and the Lambda SDK. The page now checks the
S3 PUT response, since a failed upload never produces a job.

Refs #286

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 7: Enable stage and main, docs, changelog, PR 3

**Files:**
- Modify: `infra/main/variables.tf` (`looper_async_envs` default)
- Modify: `ARCHITECTURE.md:28`, `README.md:50`
- Modify: `CLAUDE.md` (the "S3 objects" gotcha line)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Confirm PR 1 is on `main`**

Run: `git fetch origin && git log origin/main --oneline -- lambda/src/looper/handler.py | head -1`
Expected: the PR 1 squash commit. If it is not there, stop: PR 3 waits for the next promotion.

- [ ] **Step 2: Enable all three environments.** In `infra/main/variables.tf`: `default = ["dev", "stage", "main"]`.

Run: `cd infra/main && terraform plan -var-file=terraform.tfvars`
Expected: adds exactly 2 bucket notifications and 2 event source mappings (`stage`, `main`). Nothing else.

Stage and main then process each upload twice (old `/process` plus the event) until this PR is promoted. Both runs write the same output key.

- [ ] **Step 3: Update the flow diagrams.** `ARCHITECTURE.md` line 28:

```
  ├─ S3 uploads/ event → SQS → Lambda; job status in DynamoDB
  ├─ GET /api/looper/status        → polled every 2s until done/failed
```

`README.md` line 50:

```
  ├─ S3 uploads/ event → SQS → Lambda, status in DynamoDB
  ├─ GET /api/looper/status      → polled every 2s until done/failed
```

Check each file's following line (`returns presigned S3 GET URL` / `presigned S3 GET URL back`) still reads correctly after the change.

In `CLAUDE.md`, the gotcha line starting `- S3 objects: uploads under \`uploads/\``, append: ` An object created under \`uploads/\` starts a looper job through SQS (see the looper async jobs spec), so nothing else should write there.`

- [ ] **Step 4: CHANGELOG** under `## [Unreleased]`, add a `### Changed` section if absent:

```markdown
- BGM Looper processes uploads asynchronously: the upload itself starts a job through S3 events and SQS, and the page polls `/api/looper/status` for the result. A job that fails for a transient reason is retried up to three times. `/api/looper/process` is removed (#286).
```

- [ ] **Step 5: Commit, open PR 3, apply before merge**

```bash
git add infra/main/variables.tf ARCHITECTURE.md README.md CLAUDE.md CHANGELOG.md
git commit -m "feat(infra): enable async looper jobs on stage and main

Refs #286

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/looper-async-web
gh pr create --base dev --title "feat: looper polls job status; async jobs on all envs" --body "Phase 1, PR 3 of 4 (spec §7, §8). Requires PR 1 on main (checked). Paste the terraform plan summary here.

Refs #286"
```

Apply (`terraform apply -var-file=terraform.tfvars`) before merging, so dev's new page never polls against a missing notification. Then merge per the `merging-a-pr` skill.

- [ ] **Step 6: Verify on dev**, after Vercel deploys: upload a clip, watch the page go "Waiting in the queue…" → "Looping the track…" → result. Upload a non-audio file renamed `.wav`: the page shows the failure message within a few seconds, and `aws sqs get-queue-attributes --queue-url <dlq url> --attribute-names ApproximateNumberOfMessages --profile personal --region us-east-1` stays at 0 (no retries). Repeat on stage and main after each promotion.

---

## PR 4 — Remove the transition code

Branch `chore/looper-async-cleanup` from `dev`. **Start only once PR 3 is on `main`** (`git log origin/main --oneline -- web/app/api/looper/status/route.ts`).

### Task 8: Handler drops the direct-invoke path

**Files:**
- Modify: `lambda/src/looper/handler.py`
- Modify: `lambda/tests/test_handler.py`

- [ ] **Step 1: Delete the direct-invoke test** `test_handler_downloads_processes_and_uploads` from `lambda/tests/test_handler.py`, and add:

```python
def test_non_sqs_event_is_rejected(aws):
    with pytest.raises(KeyError):
        handler_module.handler({"bucket": BUCKET, "input_key": UPLOAD_KEY, "output_key": "x"}, None)
```

Run: `cd lambda && .venv/Scripts/python -m pytest tests/test_handler.py -q`
Expected: the new test FAILS (the direct path still handles the payload).

- [ ] **Step 2: Remove the direct path** from `handler.py`: delete `_process_direct` and replace `handler` with:

```python
def handler(event: dict, context) -> None:
    for record in event["Records"]:
        _process_record(record)
```

Run: `cd lambda && .venv/Scripts/python -m pytest -q`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lambda/src/looper/handler.py lambda/tests/test_handler.py
git commit -m "refactor(lambda): drop the direct-invoke path

Refs #286

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 9: Infra drops the rollout switch and the invoke grant

**Files:**
- Modify: `infra/main/variables.tf` (delete `looper_async_envs`)
- Modify: `infra/main/environments.tf` (notification + mapping over all envs; delete the three `lambda_function_name_*` Vercel env vars)
- Modify: `infra/main/shared.tf` (delete the `InvokeProcessor` statement; delete `local.all_lambda_function_arns` if nothing else references it)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Edit**
  - Delete `variable "looper_async_envs"` and its comment.
  - In `aws_s3_bucket_notification.looper_uploads` and `aws_lambda_event_source_mapping.looper_jobs`, change `for_each = toset(var.looper_async_envs)` to `for_each = local.data_bucket_suffix`. The keys stay `main`/`dev`/`stage`, so Terraform sees no change to these resources. Update the section comment to drop the sentence about `var.looper_async_envs`.
  - Delete `vercel_project_environment_variable.lambda_function_name_production`, `_preview`, `_stage` and the `LAMBDA_FUNCTION_NAME` mention in the comment above the env var block.
  - Delete the `InvokeProcessor` statement from `aws_iam_role_policy.vercel`.
  - Run `grep -n all_lambda_function_arns infra/main/*.tf`; if the definition is the only hit left, delete it and the `lambda_function_arn` local if that is then unused too.

- [ ] **Step 2: Plan**

Run: `cd infra/main && terraform fmt && terraform validate && terraform plan -var-file=terraform.tfvars`
Expected: destroys exactly the 3 `LAMBDA_FUNCTION_NAME` env vars; updates `vercel` policy in place. Notifications and mappings: no changes. Stop if any notification, mapping, queue or table would be destroyed.

- [ ] **Step 3: CHANGELOG** under `## [Unreleased]` → `### Removed`:

```markdown
- The looper Lambda no longer accepts direct invocations, and the app no longer holds `lambda:InvokeFunction` or the `LAMBDA_FUNCTION_NAME` env var (#286).
```

- [ ] **Step 4: Commit, open PR 4, apply after merge**

```bash
git add infra/main CHANGELOG.md
git commit -m "chore(infra): remove the looper async rollout switch and invoke grant

Closes #286

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin chore/looper-async-cleanup
gh pr create --base dev --title "chore: remove looper async transition code" --body "Phase 1, PR 4 of 4 (spec §7). Requires PR 3 on main (checked). Paste the terraform plan summary here.

Closes #286"
```

This PR touches `lambda/`: merge it alone, per the repo rule. After merge, `terraform apply -var-file=terraform.tfvars`, then tick Phase 1 in epic #285.
