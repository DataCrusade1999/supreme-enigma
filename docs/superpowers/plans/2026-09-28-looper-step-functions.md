# Looper Jobs on Step Functions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace S3 → SQS → Lambda with S3 → EventBridge → a Step Functions state machine that owns job status in DynamoDB and calls the Lambda only for DSP.

**Architecture:** Buckets send events to EventBridge; a rule per environment starts a Standard state machine with `{bucket, key}`. The state machine marks the row `processing`, invokes the Lambda, and marks it `done` or `failed` through direct DynamoDB `updateItem` tasks with the same conditional writes phase 1 used. The Lambda keeps only the DSP work and phase 2's Powertools instrumentation.

**Tech Stack:** AWS Step Functions (Standard, JSONata), EventBridge rules with input transformers, Terraform `aws` ~> 6.62; Python 3.12 + Powertools + pytest/moto; Next.js 16 + Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-looper-step-functions-design.md`. Issue #288, epic #285.

**Starts after:** phase 1 (#286) and phase 2 (#287) are complete. `handler.py` has the SQS path instrumented with Powertools; `aws_cloudwatch_log_group.looper`, `aws_cloudwatch_dashboard.looper`, `local.looper_function`, the SQS/DLQ/table resources and `aws_iam_role_policy.lambda_jobs` all exist.

## Global Constraints

- State machine name `looper-jobs-<env>`, type `STANDARD`, `QueryLanguage = "JSONata"`, `TimeoutSeconds = 600`.
- Lambda Step Functions input `{"bucket": str, "key": str}`; output `{"outputKey": str, "meta": dict}`; DSP failure raises `PipelineRejected`.
- DynamoDB attribute for the result: `resultJson` (S), the metadata JSON string. Failure messages: `FAILED_MESSAGE` (unchanged, rejection) and `"Processing failed. Try again."` (retries exhausted).
- Retry on `Process`: `PipelineRejected` max 0; `States.ALL` interval 10s, max 2, backoff 2.
- Conditions: first write `attribute_not_exists(#status) OR #status = :processing`; final writes `#status = :processing`. `ConditionalCheckFailedException` → `AlreadyFinished` (Succeed).
- Upload keys: `uploads/<uuid>` plus `.` and up to 10 `[A-Za-z0-9]` characters.
- Rollout switch `var.looper_sfn_envs`, default `["dev"]`, removed in PR C.
- Every manual `aws` CLI call: `--profile personal --region us-east-1`.
- Terraform: plan against real state, apply with the owner's go-ahead before merge, then `No changes.`.
- While Actions billing blocks CI: local suites plus the owner's go-ahead gate merges; Lambda deployed by hand (phase 1 plan, "Deploying the Lambda while Actions is blocked").
- Commits end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.

## Review Focus

- **Duplicate EventBridge delivery**: two executions for one key. The second must end in `AlreadyFinished`, never overwrite `done`. Checked in Task 4 with a manual double start.
- **A job in flight during the switch**: PR C's apply destroys each queue and its event source mapping in the same run that moves the notification to EventBridge. A message still in a queue at that moment is deleted with it, and its row stays `processing`. Task 6 therefore switches the notifications first with a targeted apply, waits for the main and stage queues to drain, and only then applies the rest. An invocation already running when the mapping goes finishes normally, since the SQS code stays in the Lambda until PR C's image is deployed.
- **Retries that outlast the page**: a Lambda that times out is retried twice, so the worst case before `MarkErrored` is about 210s (60 + 10 + 60 + 20 + 60), while the page gives up at `TOTAL_TIMEOUT_MS` (120s). The row still ends `failed`, but the page shows "Processing timed out" first. Fast failures (a missing object, S3 errors) finish in about 30s and reach the page as `failed`. Accepted: raising the page timeout is outside this phase (spec §2).
- **A metadata object with a `null`** (`tempo_bpm: null` on the no-beat-grid path): `$string()` must keep it as JSON `null` and the page must still render "no beat grid found". Test in Task 2 (web) with a `resultJson` containing nulls.
- **Retries exhausted**: the row must end `failed`, not `processing`. Checked in Task 4 by starting an execution for a missing object.
- **A rejected file must not retry**: one Lambda invocation only. Checked in Task 4 by counting invocations in the execution history.

## PR order

| PR | Branch | Tasks | Merge only after |
|---|---|---|---|
| A | `feat/looper-sfn-handler` | 1, 2 | — |
| B | `feat/looper-sfn-infra` | 3, 4 | PR A merged into `dev` and dev's Lambda redeployed |
| C | `chore/looper-sfn-switch` | 5, 6 | PR A on `main`, and stage/main Lambdas redeployed from it |

---

## PR A — Lambda accepts Step Functions input; web reads `resultJson`

Branch `feat/looper-sfn-handler` from `dev`.

### Task 1: Step Functions entry point in the handler

**Files:**
- Modify: `lambda/src/looper/handler.py`
- Modify: `lambda/tests/test_handler.py`

**Interfaces:**
- Consumes: phase 2 handler (`logger`, `tracer`, `metrics`, `_run_pipeline`, `_paths`, SQS path).
- Produces: `class PipelineRejected(Exception)`; `_process_step(event: dict) -> dict` returning `{"outputKey": str, "meta": dict}` (its body in `_run_step(bucket, key)`); `handler` dispatches on `"Records" in event`.

- [ ] **Step 1: Write the failing tests.** Append to `lambda/tests/test_handler.py`:

```python
def test_step_input_processes_and_returns_output_and_meta(aws, monkeypatch, capsys, lambda_context):
    s3, table = aws
    s3.put_object(Bucket=BUCKET, Key=UPLOAD_KEY, Body=b"audio")
    monkeypatch.setattr(handler_module, "process", fake_process)

    result = handler_module.handler({"bucket": BUCKET, "key": UPLOAD_KEY}, lambda_context)

    output_key = UPLOAD_KEY.replace("uploads/", "outputs/")
    assert result == {
        "outputKey": output_key,
        "meta": {"peaks": [0.5, 1.0], "tempo_bpm": 96.0, "loop_start_sec": None},
    }
    assert s3.get_object(Bucket=BUCKET, Key=output_key)["Body"].read() == b"audio-processed"
    # The state machine owns the row now; the Lambda does not write it.
    assert table.scan()["Count"] == 0
    (line,) = metric_lines(capsys)
    assert "JobSucceeded" in line


def test_step_input_rejection_raises_pipeline_rejected(aws, monkeypatch, capsys, lambda_context):
    s3, _ = aws
    s3.put_object(Bucket=BUCKET, Key=UPLOAD_KEY, Body=b"not audio")

    def reject(input_path, output_path, target_lufs=-14.0):
        raise ValueError("could not decode")

    monkeypatch.setattr(handler_module, "process", reject)

    with pytest.raises(handler_module.PipelineRejected):
        handler_module.handler({"bucket": BUCKET, "key": UPLOAD_KEY}, lambda_context)

    # log_metrics flushes even when the handler raises.
    (line,) = metric_lines(capsys)
    assert "JobRejected" in line


def test_step_input_s3_error_propagates_for_retry(aws, monkeypatch, capsys, lambda_context):
    monkeypatch.setattr(handler_module, "process", fake_process)

    with pytest.raises(ClientError):
        handler_module.handler({"bucket": BUCKET, "key": UPLOAD_KEY}, lambda_context)

    # Same as the SQS path: the failed-jobs query needs the key on the error line.
    (failed,) = [line for line in printed_json(capsys) if line.get("level") == "ERROR"]
    assert failed["job_key"] == UPLOAD_KEY
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd lambda && .venv/Scripts/python -m pytest tests/test_handler.py -q -k step_input`
Expected: FAIL — `KeyError: 'Records'` and no `PipelineRejected`.

If `test_step_input_rejection_raises_pipeline_rejected` later fails only on the metric assertion, Powertools is not flushing on exceptions in this version: move the `metrics.add_metric` call into a `try/finally` that calls `metrics.flush_metrics()` before re-raising, and keep the test.

- [ ] **Step 3: Implement.** In `lambda/src/looper/handler.py`, add after `FAILED_MESSAGE`:

```python
class PipelineRejected(Exception):
    """The pipeline could not process this audio. Step Functions matches the
    class name: this error is not retried, and the row is written failed."""
```

Replace `handler` with:

```python
@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def handler(event: dict, context) -> dict | None:
    # SQS path: removed once every env runs on Step Functions (phase 3, PR C).
    if "Records" in event:
        for record in event["Records"]:
            _process_record(record)
        return None
    return _process_step(event)
```

Add:

```python
def _process_step(event: dict) -> dict:
    """One job for the Step Functions state machine, which owns the job-status
    row. Raises PipelineRejected for bad audio; anything else is retried."""
    bucket = event["bucket"]
    key = event["key"]
    logger.append_keys(job_key=key)
    try:
        return _run_step(bucket, key)
    except PipelineRejected:
        raise  # already logged where it was raised
    except Exception:
        logger.exception("Job failed; the state machine will retry it")
        raise
    finally:
        logger.remove_keys(["job_key"])


def _run_step(bucket: str, key: str) -> dict:
    started = time.monotonic()
    output_key = "outputs/" + key.removeprefix("uploads/")
    input_path, output_path = _paths(key)
    s3.download_file(bucket, key, input_path)
    try:
        meta = _run_pipeline(input_path, output_path)
    except Exception as err:
        logger.exception("Pipeline rejected the upload")
        metrics.add_metric(name="JobRejected", unit=MetricUnit.Count, value=1)
        raise PipelineRejected(str(err)) from err
    s3.upload_file(output_path, bucket, output_key)
    metrics.add_metric(name="JobSucceeded", unit=MetricUnit.Count, value=1)
    logger.info(
        "job finished",
        extra={"duration_ms": round((time.monotonic() - started) * 1000)},
    )
    return {"outputKey": output_key, "meta": meta}
```

- [ ] **Step 4: Run the full suite**

Run: `cd lambda && .venv/Scripts/python -m pytest -q`
Expected: PASS (SQS tests unchanged, three new tests pass).

- [ ] **Step 5: Commit**

```bash
git add lambda/src/looper/handler.py lambda/tests/test_handler.py
git commit -m "feat(lambda): accept Step Functions input alongside SQS

Refs #288

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 2: Web reads `resultJson`; upload keys never need encoding

**Files:**
- Modify: `web/lib/looper-jobs.ts`, `web/lib/looper-jobs.test.ts`
- Modify: `web/lib/aws.ts` (`keyForUpload`), `web/lib/aws.test.ts` (`describe("keyForUpload", …)`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: rows with either `result` (M, SQS path) or `resultJson` (S, state machine).
- Produces: unchanged `JobStatus` type; `keyForUpload` output matching `^uploads/<uuid>(\.[A-Za-z0-9]{1,10})?$`.

- [ ] **Step 1: Failing tests.** In `web/lib/looper-jobs.test.ts`, inside `describe("getJobStatus", …)`, add:

```ts
  it("parses the result the state machine stores as a JSON string", async () => {
    send.mockResolvedValue({
      Item: marshall({
        jobKey: KEY,
        status: "done",
        outputKey: "outputs/x.wav",
        resultJson: JSON.stringify({ peaks: [0.5, 1], tempo_bpm: null, loop_start_sec: null }),
      }),
    });
    expect(await getJobStatus(KEY)).toEqual({
      status: "done",
      outputKey: "outputs/x.wav",
      result: { peaks: [0.5, 1], tempo_bpm: null, loop_start_sec: null },
    });
  });
```

In `web/lib/aws.test.ts`, replace the `describe("keyForUpload", …)` block with:

```ts
describe("keyForUpload", () => {
  it("prefixes with uploads/ and preserves the extension", () => {
    expect(keyForUpload("my song.mp3")).toMatch(/^uploads\/[0-9a-f-]{36}\.mp3$/);
  });

  it("keeps the extension's case", () => {
    expect(keyForUpload("a.WAV")).toMatch(/^uploads\/[0-9a-f-]{36}\.WAV$/);
  });

  it("drops characters S3 would have to encode in an event", () => {
    expect(keyForUpload("take.final mix+2")).toMatch(/^uploads\/[0-9a-f-]{36}\.finalmix2$/);
  });

  it("caps the extension at 10 characters", () => {
    expect(keyForUpload("a.abcdefghijklmnop")).toMatch(/^uploads\/[0-9a-f-]{36}\.abcdefghij$/);
  });

  it("handles filenames with no extension, or none left after cleaning", () => {
    expect(keyForUpload("noext")).toMatch(/^uploads\/[0-9a-f-]{36}$/);
    expect(keyForUpload("a.???")).toMatch(/^uploads\/[0-9a-f-]{36}$/);
  });
});
```

Run: `cd web && npx vitest run lib/looper-jobs.test.ts lib/aws.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 2: Implement.** In `web/lib/looper-jobs.ts`, change the `done` case to:

```ts
    case "done":
      return {
        status: "done",
        outputKey: item.outputKey,
        // resultJson from the state machine; result from the SQS path, which
        // phase 3's switch PR removes.
        result: item.resultJson ? JSON.parse(item.resultJson) : item.result,
      };
```

In `web/lib/aws.ts`, replace `keyForUpload` with:

```ts
// The extension keeps only letters and digits, so an upload key never needs
// URL-encoding in an S3 event and the job-status row is keyed exactly as the
// page asks for it.
export function keyForUpload(filename: string): string {
  const raw = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1) : "";
  const ext = raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
  return `uploads/${randomUUID()}${ext ? `.${ext}` : ""}`;
}
```

Run: `cd web && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 3: CHANGELOG** under `## [Unreleased]` → `### Changed`:

```markdown
- BGM Looper upload keys keep only letters and digits in the file extension (#288).
```

- [ ] **Step 4: Commit and open PR A**

```bash
git add web/lib/looper-jobs.ts web/lib/looper-jobs.test.ts web/lib/aws.ts web/lib/aws.test.ts CHANGELOG.md
git commit -m "feat(web): read state-machine job results; keep upload keys encoding-free

Refs #288

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/looper-sfn-handler
gh pr create --base dev --title "feat: prepare looper for Step Functions" --body "Phase 3, PR A of 3 (spec 2026-09-28-looper-step-functions-design.md §7). No behaviour change: the Lambda accepts Step Functions input alongside SQS, and the status route reads either result attribute.

Refs #288"
```

Merge per `merging-a-pr` (touches `lambda/`: alone). Deploy dev's Lambda.

---

## PR B — State machines, rules and roles; dev switched

Branch `feat/looper-sfn-infra` from `dev` after PR A merges.

### Task 3: Step Functions and EventBridge resources

**Files:**
- Modify: `infra/main/variables.tf`
- Modify: `infra/main/environments.tf` (new Step Functions section; `aws_s3_bucket_notification.looper_uploads`; `aws_lambda_event_source_mapping.looper_jobs`)
- Modify: `infra/main/shared.tf` (two roles)

**Interfaces:**
- Consumes: `aws_dynamodb_table.looper_jobs`, `local.looper_function`, `aws_s3_bucket.data`, `aws_sns_topic.budget_alerts`.
- Produces: `aws_sfn_state_machine.looper[env]`, `aws_cloudwatch_event_rule.looper_uploads[env]`, `aws_iam_role.looper_sfn`, `aws_iam_role.looper_events`, `var.looper_sfn_envs`.

- [ ] **Step 1: Variable.** Append to `infra/main/variables.tf`:

```hcl
# Environments whose uploads/ events go S3 -> EventBridge -> Step Functions instead of
# S3 -> SQS -> Lambda. Exists only for the phase 3 rollout; removed with the SQS
# resources (spec 2026-09-28-looper-step-functions-design.md §7).
variable "looper_sfn_envs" {
  type    = list(string)
  default = ["dev"]
}
```

- [ ] **Step 2: Roles.** Append to `infra/main/shared.tf`:

```hcl
# --- Looper Step Functions: one role for the three state machines, one for the
#     EventBridge rules that start them ---

resource "aws_iam_role" "looper_sfn" {
  name = "${var.project_name}-looper-sfn"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "states.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "looper_sfn" {
  name = "${var.project_name}-looper-sfn"
  role = aws_iam_role.looper_sfn.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteJobStatus"
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem"]
        Resource = [for t in aws_dynamodb_table.looper_jobs : t.arn]
      },
      {
        Sid      = "RunPipeline"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = flatten([for f in local.looper_function : [f.arn, "${f.arn}:*"]])
      },
      {
        # Vended log delivery for execution logs; these actions do not support
        # resource-level permissions.
        Sid    = "ExecutionLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogDelivery", "logs:GetLogDelivery", "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery", "logs:ListLogDeliveries", "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies", "logs:DescribeLogGroups",
        ]
        Resource = "*"
      },
      {
        Sid      = "Tracing"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role" "looper_events" {
  name = "${var.project_name}-looper-events"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "events.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "looper_events" {
  name = "${var.project_name}-looper-events"
  role = aws_iam_role.looper_events.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["states:StartExecution"]
      Resource = [for m in aws_sfn_state_machine.looper : m.arn]
    }]
  })
}
```

- [ ] **Step 3: State machines, rules, alarms.** Append to `infra/main/environments.tf`:

```hcl
# --- Looper jobs on Step Functions (spec 2026-09-28-looper-step-functions-design.md) ---

locals {
  looper_job_ttl_expr = "{% $string($floor($toMillis($now()) / 1000) + 86400) %}"

  # Shared by every status write: the same attributes phase 1's Lambda wrote.
  looper_status_names = { "#status" = "status" }
}

resource "aws_cloudwatch_log_group" "looper_sfn" {
  for_each          = local.data_bucket_suffix
  name              = "/aws/vendedlogs/states/looper-jobs-${each.key}"
  retention_in_days = 14
}

resource "aws_sfn_state_machine" "looper" {
  for_each = local.data_bucket_suffix
  name     = "looper-jobs-${each.key}"
  type     = "STANDARD"
  role_arn = aws_iam_role.looper_sfn.arn

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.looper_sfn[each.key].arn}:*"
    include_execution_data = false
    level                  = "ERROR"
  }

  tracing_configuration {
    enabled = true
  }

  # CreateStateMachine checks the role can deliver logs; role_arn alone does not
  # wait for the policy that grants it.
  depends_on = [aws_iam_role_policy.looper_sfn]

  definition = jsonencode({
    Comment        = "BGM Looper job (${each.key})"
    QueryLanguage  = "JSONata"
    TimeoutSeconds = 600
    StartAt        = "MarkProcessing"
    States = {
      MarkProcessing = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:updateItem"
        Arguments = {
          TableName                = aws_dynamodb_table.looper_jobs[each.key].name
          Key                      = { jobKey = { S = "{% $states.input.key %}" } }
          UpdateExpression         = "SET #status = :processing, updatedAt = :now, expiresAt = :exp"
          ConditionExpression      = "attribute_not_exists(#status) OR #status = :processing"
          ExpressionAttributeNames = local.looper_status_names
          ExpressionAttributeValues = {
            ":processing" = { S = "processing" }
            ":now"        = { S = "{% $now() %}" }
            ":exp"        = { N = local.looper_job_ttl_expr }
          }
        }
        Output = "{% $states.input %}"
        Catch  = [{ ErrorEquals = ["DynamoDB.ConditionalCheckFailedException"], Next = "AlreadyFinished" }]
        Next   = "Process"
      }
      Process = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Arguments = {
          FunctionName = local.looper_function[each.key].arn
          Payload      = "{% $states.input %}"
        }
        Output = "{% $merge([$states.input, $states.result.Payload]) %}"
        Retry = [
          { ErrorEquals = ["PipelineRejected"], MaxAttempts = 0 },
          { ErrorEquals = ["States.ALL"], IntervalSeconds = 10, MaxAttempts = 2, BackoffRate = 2 },
        ]
        Catch = [
          { ErrorEquals = ["PipelineRejected"], Next = "MarkRejected", Output = "{% $states.input %}" },
          { ErrorEquals = ["States.ALL"], Next = "MarkErrored", Output = "{% $states.input %}" },
        ]
        Next = "MarkDone"
      }
      MarkDone = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:updateItem"
        Arguments = {
          TableName                = aws_dynamodb_table.looper_jobs[each.key].name
          Key                      = { jobKey = { S = "{% $states.input.key %}" } }
          UpdateExpression         = "SET #status = :done, outputKey = :out, resultJson = :result, updatedAt = :now, expiresAt = :exp"
          ConditionExpression      = "#status = :processing"
          ExpressionAttributeNames = local.looper_status_names
          ExpressionAttributeValues = {
            ":done"       = { S = "done" }
            ":processing" = { S = "processing" }
            ":out"        = { S = "{% $states.input.outputKey %}" }
            ":result"     = { S = "{% $string($states.input.meta) %}" }
            ":now"        = { S = "{% $now() %}" }
            ":exp"        = { N = local.looper_job_ttl_expr }
          }
        }
        Catch = [{ ErrorEquals = ["DynamoDB.ConditionalCheckFailedException"], Next = "AlreadyFinished" }]
        End   = true
      }
      MarkRejected = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:updateItem"
        Arguments = {
          TableName                = aws_dynamodb_table.looper_jobs[each.key].name
          Key                      = { jobKey = { S = "{% $states.input.key %}" } }
          UpdateExpression         = "SET #status = :failed, #error = :msg, updatedAt = :now, expiresAt = :exp"
          ConditionExpression      = "#status = :processing"
          ExpressionAttributeNames = { "#status" = "status", "#error" = "error" }
          ExpressionAttributeValues = {
            ":failed"     = { S = "failed" }
            ":processing" = { S = "processing" }
            # Must match FAILED_MESSAGE in lambda/src/looper/handler.py.
            ":msg" = { S = "This file could not be processed. It may not be a supported audio format." }
            ":now" = { S = "{% $now() %}" }
            ":exp" = { N = local.looper_job_ttl_expr }
          }
        }
        Catch = [{ ErrorEquals = ["DynamoDB.ConditionalCheckFailedException"], Next = "AlreadyFinished" }]
        End   = true
      }
      MarkErrored = {
        Type     = "Task"
        Resource = "arn:aws:states:::dynamodb:updateItem"
        Arguments = {
          TableName                = aws_dynamodb_table.looper_jobs[each.key].name
          Key                      = { jobKey = { S = "{% $states.input.key %}" } }
          UpdateExpression         = "SET #status = :failed, #error = :msg, updatedAt = :now, expiresAt = :exp"
          ConditionExpression      = "#status = :processing"
          ExpressionAttributeNames = { "#status" = "status", "#error" = "error" }
          ExpressionAttributeValues = {
            ":failed"     = { S = "failed" }
            ":processing" = { S = "processing" }
            ":msg"        = { S = "Processing failed. Try again." }
            ":now"        = { S = "{% $now() %}" }
            ":exp"        = { N = local.looper_job_ttl_expr }
          }
        }
        Catch = [{ ErrorEquals = ["DynamoDB.ConditionalCheckFailedException"], Next = "AlreadyFinished" }]
        Next  = "Failed"
      }
      # Ends the execution as failed so ExecutionsFailed (and its alarm) sees it.
      Failed = {
        Type  = "Fail"
        Error = "JobFailed"
        Cause = "The pipeline failed after retries."
      }
      AlreadyFinished = { Type = "Succeed" }
    }
  })
}

resource "aws_cloudwatch_event_rule" "looper_uploads" {
  for_each    = local.data_bucket_suffix
  name        = "looper-uploads-${each.key}"
  description = "uploads/ objects in ${aws_s3_bucket.data[each.key].bucket} start a looper job"
  event_pattern = jsonencode({
    source        = ["aws.s3"]
    "detail-type" = ["Object Created"]
    detail = {
      bucket = { name = [aws_s3_bucket.data[each.key].bucket] }
      object = { key = [{ prefix = "uploads/" }] }
    }
  })
}

resource "aws_cloudwatch_event_target" "looper_uploads" {
  for_each = aws_cloudwatch_event_rule.looper_uploads
  rule     = each.value.name
  arn      = aws_sfn_state_machine.looper[each.key].arn
  role_arn = aws_iam_role.looper_events.arn

  input_transformer {
    input_paths = {
      bucket = "$.detail.bucket.name"
      key    = "$.detail.object.key"
    }
    input_template = "{\"bucket\": <bucket>, \"key\": <key>}"
  }

  retry_policy {
    maximum_retry_attempts       = 3
    maximum_event_age_in_seconds = 3600
  }

  # An upload between the target existing and the role being allowed to start
  # executions would never get its execution.
  depends_on = [aws_iam_role_policy.looper_events]
}

resource "aws_cloudwatch_metric_alarm" "looper_sfn_failed" {
  for_each = aws_sfn_state_machine.looper

  alarm_name          = "${each.value.name}-executions-failed"
  namespace           = "AWS/States"
  metric_name         = "ExecutionsFailed"
  dimensions          = { StateMachineArn = each.value.arn }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
  ok_actions          = [aws_sns_topic.budget_alerts.arn]

  alarm_description = "A looper job failed after retries in ${each.value.name}. Open the execution in the Step Functions console."
}
```

- [ ] **Step 4: Switch dev's notification and mapping.** Replace the phase 1 `aws_s3_bucket_notification.looper_uploads` and `aws_lambda_event_source_mapping.looper_jobs` with:

```hcl
# A bucket takes one aws_s3_bucket_notification. Envs in var.looper_sfn_envs send
# to EventBridge (all events; the rule filters uploads/), the rest to SQS.
resource "aws_s3_bucket_notification" "looper_uploads" {
  for_each    = local.data_bucket_suffix
  bucket      = aws_s3_bucket.data[each.key].id
  eventbridge = contains(var.looper_sfn_envs, each.key)

  dynamic "queue" {
    for_each = contains(var.looper_sfn_envs, each.key) ? [] : [1]
    content {
      queue_arn     = aws_sqs_queue.looper_jobs[each.key].arn
      events        = ["s3:ObjectCreated:*"]
      filter_prefix = "uploads/"
    }
  }

  depends_on = [aws_sqs_queue_policy.looper_jobs]
}

resource "aws_lambda_event_source_mapping" "looper_jobs" {
  for_each         = setsubtract(keys(local.data_bucket_suffix), var.looper_sfn_envs)
  event_source_arn = aws_sqs_queue.looper_jobs[each.key].arn
  function_name    = local.looper_function[each.key].arn
  batch_size       = 1

  scaling_config {
    maximum_concurrency = 2
  }

  depends_on = [aws_iam_role_policy.lambda_jobs]
}
```

- [ ] **Step 5: Validate the definition with AWS before planning**

Terraform does not check ASL; AWS only rejects a bad definition at apply time. Render dev's definition from a saved plan and ask AWS first. The file goes in the working directory, not `/tmp`: in Git Bash, `> /tmp/x` writes under MSYS's temp directory while `aws.exe` resolves `file:///tmp/x` against the drive root, so the two never meet.

```bash
cd infra/main && terraform fmt && terraform validate
terraform plan -var-file=terraform.tfvars -out=phase3.plan
terraform show -json phase3.plan | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const rc = JSON.parse(s).resource_changes.find(r => r.address === "aws_sfn_state_machine.looper[\"dev\"]");
    process.stdout.write(rc.change.after.definition);
  });' > looper-sfn.json
rm phase3.plan
aws stepfunctions validate-state-machine-definition --definition file://looper-sfn.json --type STANDARD --profile personal --region us-east-1
rm looper-sfn.json
```

Expected: `"result": "OK"` and no diagnostics. Fix any `ERROR` diagnostic in the HCL before continuing.

- [ ] **Step 6: Plan**

Run: `terraform plan -var-file=terraform.tfvars`
Expected creates: 2 roles + 2 policies, 3 log groups, 3 state machines, 3 rules, 3 targets, 3 alarms. Updates in place: `aws_s3_bucket_notification.looper_uploads["dev"]` (queue → eventbridge). Destroys: exactly `aws_lambda_event_source_mapping.looper_jobs["dev"]`. Nothing else destroyed or replaced.

### Task 4: Apply, test on dev, open PR B

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: CHANGELOG** under `## [Unreleased]` → `### Added`:

```markdown
- BGM Looper jobs run on a Step Functions state machine per environment, started by an EventBridge rule on uploads. The state machine records job status in DynamoDB itself, retries transient failures twice, and marks a job failed instead of leaving it processing. Enabled on `dev` (#288).
```

- [ ] **Step 2: Commit and open PR B**

```bash
git add infra/main/variables.tf infra/main/environments.tf infra/main/shared.tf CHANGELOG.md
git commit -m "feat(infra): looper state machines and upload rules; switch dev

Refs #288

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/looper-sfn-infra
gh pr create --base dev --title "feat(infra): looper jobs on Step Functions (dev)" --body "Phase 3, PR B of 3. Paste the terraform plan summary and the validate-state-machine-definition result here.

Refs #288"
```

- [ ] **Step 3: Apply** with the owner's go-ahead: `terraform apply -var-file=terraform.tfvars`, then `terraform plan` shows `No changes.`.

- [ ] **Step 4: TestState one state** against dev's table:

```bash
SM=$(aws stepfunctions list-state-machines --query "stateMachines[?name=='looper-jobs-dev'].stateMachineArn" --output text --profile personal --region us-east-1)
aws stepfunctions describe-state-machine --state-machine-arn $SM --query definition --output text --profile personal --region us-east-1 > def.json
ROLE=$(aws iam get-role --role-name bgm-looper-looper-sfn --query Role.Arn --output text --profile personal)
aws stepfunctions test-state --definition file://def.json --state-name MarkProcessing --role-arn $ROLE --input '{"bucket":"x","key":"uploads/00000000-0000-4000-8000-000000000000.wav"}' --profile personal --region us-east-1
```

Expected: `"status": "SUCCEEDED"`. Run it a second time: still `SUCCEEDED` (a `processing` row passes the condition). Delete the row: `aws dynamodb delete-item --table-name looper-jobs-dev --key '{"jobKey":{"S":"uploads/00000000-0000-4000-8000-000000000000.wav"}}' --profile personal --region us-east-1`, then `rm def.json`.

If `test-state` rejects `--definition` as a whole machine, pass only the state's JSON and drop `--state-name` (`jq` is not installed here, so use node):

```bash
node -e 'const d = require("./def.json"); process.stdout.write(JSON.stringify({ ...d.States.MarkProcessing, QueryLanguage: "JSONata" }));' > state.json
```

then `--definition file://state.json`, and `rm state.json` afterwards.

- [ ] **Step 5: Manual runs on dev**

1. Upload a clip on https://dev.ashutosh-pandey.com/tools/bgm-looper. The page goes queued → processing → result. Step Functions console → `looper-jobs-dev` → newest execution is `Succeeded`, path MarkProcessing → Process → MarkDone.
2. Upload a text file renamed `.wav`. Execution `Succeeded` via `MarkRejected`; the execution's event history shows **one** `LambdaFunctionScheduled`. The page shows the rejection message.
3. Missing object (retries exhausted):
   `aws stepfunctions start-execution --state-machine-arn $SM --input '{"bucket":"portfolio-data-dev-223376380711","key":"uploads/00000000-0000-4000-8000-000000000001.wav"}' --profile personal --region us-east-1`
   Execution ends `Failed` after three Lambda attempts (≈ 30s); the row is `failed` / "Processing failed. Try again."; the `looper-jobs-dev-executions-failed` alarm emails within 5 minutes. Delete the row afterwards.
4. Duplicate: start two executions with the same input as a real, already-`done` key from step 1. Both end `Succeeded` via `AlreadyFinished`; the row is unchanged.

- [ ] **Step 6: Merge** per `merging-a-pr`.

---

## PR C — All envs on Step Functions; SQS removed

Branch `chore/looper-sfn-switch` from `dev`. Confirm PR A is on `main` and both stage and main Lambdas run an image built from it (phase 1 plan, Task 7 Step 1 shows the check).

### Task 5: Lambda and web drop the SQS path

**Files:**
- Modify: `lambda/src/looper/handler.py`
- Modify: `lambda/tests/test_handler.py`
- Modify: `web/lib/looper-jobs.ts`, `web/lib/looper-jobs.test.ts`

- [ ] **Step 1: Remove the SQS tests.** Delete from `lambda/tests/test_handler.py` every test that calls `sqs_event(...)` or asserts on the `jobs` table written by the Lambda: `test_sqs_event_processes_upload_and_records_done`, `test_sqs_event_key_is_url_decoded`, `test_s3_test_event_is_skipped`, `test_pipeline_rejection_records_failed_without_raising`, `test_s3_error_raises_so_sqs_retries`, `test_redelivery_after_transient_failure_processes`, `test_duplicate_delivery_leaves_finished_job_alone`, `test_concurrent_duplicate_finishing_first_is_not_an_error`, phase 2's `test_done_job_emits_success_metric_and_duration`, `test_rejected_job_emits_rejection_metric`, `test_duplicate_that_loses_the_race_is_not_counted`, `test_transient_failure_is_logged_with_its_key_then_the_key_is_cleared`, `test_metrics_flush_without_looper_env`, and phase 1 PR 4's `test_non_sqs_event_is_rejected`. Delete the `sqs_event` helper. In the `aws` fixture, remove the DynamoDB table creation and the `JOBS_TABLE_NAME` env var, and yield only `s3`; in the `step_input` tests change `s3, table = aws` / `s3, _ = aws` to `s3 = aws` and drop the `table.scan()` assertion.

Add two tests that carry over what the deleted ones protected:

```python
def test_step_input_logs_duration_and_clears_the_job_key(aws, monkeypatch, capsys, lambda_context):
    s3 = aws
    s3.put_object(Bucket=BUCKET, Key=UPLOAD_KEY, Body=b"audio")
    monkeypatch.setattr(handler_module, "process", fake_process)

    handler_module.handler({"bucket": BUCKET, "key": UPLOAD_KEY}, lambda_context)
    handler_module.logger.info("after")

    lines = printed_json(capsys)
    (finished,) = [line for line in lines if line.get("message") == "job finished"]
    assert finished["job_key"] == UPLOAD_KEY
    assert isinstance(finished["duration_ms"], int)
    (after,) = [line for line in lines if line.get("message") == "after"]
    assert "job_key" not in after


def test_sqs_records_are_no_longer_accepted(aws, lambda_context):
    with pytest.raises(KeyError):
        handler_module.handler({"Records": [{"body": "{}"}]}, lambda_context)
```

Run: `cd lambda && .venv/Scripts/python -m pytest -q`
Expected: `test_sqs_records_are_no_longer_accepted` FAILS (the SQS path still runs); the rest pass.

- [ ] **Step 2: Remove the SQS path** from `handler.py`: delete `_process_record`, `_process_upload`, `_run_job`, `_write_status`, `_to_dynamo`, `JOB_TTL_SECONDS`, and the now-unused imports (`json`, `datetime`, `timezone`, `Decimal`, `unquote_plus`, `ClientError`). Keep `FAILED_MESSAGE` only if still referenced; it is not (the state machine holds the message), so delete it and update the comment in the state machine's `MarkRejected` from "Must match FAILED_MESSAGE in …" to "Shown on the page as-is.". Replace `handler` with:

```python
@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def handler(event: dict, context) -> dict:
    return _process_step(event)
```

and in `_process_step`, `bucket = event["bucket"]` raises `KeyError` for an SQS-shaped event, which is what the new test expects.

Run: `cd lambda && .venv/Scripts/python -m pytest -q`
Expected: PASS.

- [ ] **Step 3: Web drops the `result` fallback.** In `web/lib/looper-jobs.ts`, the `done` case becomes `result: JSON.parse(item.resultJson)` and its comment is removed. In `web/lib/looper-jobs.test.ts`, change the `"reports done with the output key and the pipeline's metadata"` test's row to use `resultJson: JSON.stringify({ peaks: [0.5, 1], tempo_bpm: 96, loop_start_sec: null })` instead of `result`, and delete the separate `resultJson` test added in Task 2 (now a duplicate).

Run: `cd web && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lambda web/lib/looper-jobs.ts web/lib/looper-jobs.test.ts
git commit -m "refactor: drop the SQS job path from the looper Lambda and status reader

Refs #288

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 6: Infra switches all envs and removes SQS

**Files:**
- Modify: `infra/main/variables.tf`, `infra/main/environments.tf`, `infra/main/shared.tf`
- Modify: `CHANGELOG.md`, `ARCHITECTURE.md`, `README.md`, `CLAUDE.md`, `docs/runbooks/incident-tool-down.md`

- [ ] **Step 1: Edit**
  - Delete `variable "looper_sfn_envs"`.
  - `aws_s3_bucket_notification.looper_uploads`: set `eventbridge = true`, delete the `dynamic "queue"` block and the `depends_on`; update its comment to "Every event goes to EventBridge; the looper_uploads rule filters uploads/.".
  - Delete `aws_lambda_event_source_mapping.looper_jobs`, `aws_sqs_queue.looper_jobs`, `aws_sqs_queue.looper_jobs_dlq`, `aws_sqs_queue_policy.looper_jobs`, `aws_cloudwatch_metric_alarm.looper_jobs_dlq`.
  - Delete `aws_iam_role_policy.lambda_jobs` from `shared.tf`, and any `depends_on` that names it.
  - Remove `JOBS_TABLE_NAME` from both Lambda resources' `environment.variables` (keep `LOOPER_ENV`).
  - In `aws_cloudwatch_dashboard.looper`, replace the DLQ series with:
    ```hcl
    ["AWS/States", "ExecutionsFailed", "StateMachineArn", aws_sfn_state_machine.looper[env].arn, { stat = "Sum", label = "Executions failed" }],
    ```
  - In the phase 1 section comment, replace the SQS description with one line pointing at the Step Functions section.

- [ ] **Step 2: Plan**

Run: `cd infra/main && terraform fmt && terraform validate && terraform plan -var-file=terraform.tfvars`
Expected destroys: 3 queues, 3 DLQs, 3 queue policies, 2 event source mappings (`main`, `stage`), 3 DLQ alarms, `lambda_jobs` policy. Updates: notifications for `main` and `stage` (queue → eventbridge), both Lambda resources (env), dashboard. No state machine, rule, table or bucket touched.

- [ ] **Step 3: Docs.**
  - `ARCHITECTURE.md` and `README.md` flow diagrams: `S3 uploads/ event → SQS → Lambda` becomes `S3 uploads/ event → EventBridge → Step Functions (→ Lambda); job status in DynamoDB`.
  - `CLAUDE.md`'s `S3 objects` gotcha: `starts a looper job through SQS` becomes `starts a looper job (EventBridge → Step Functions)`.
  - `docs/runbooks/incident-tool-down.md` (as phase 1 left it): in the request path, `S3 event → SQS → Lambda, which writes the job row in DynamoDB` becomes `S3 event → EventBridge → Step Functions, which writes the job row in DynamoDB and invokes the Lambda`. Under "A job fails or never finishes": for "never started", check the `looper-uploads-<env>` rule's `Invocations`/`FailedInvocations` metrics and that the bucket notification has EventBridge on, instead of the event source mapping; for "timed out", open the newest `looper-jobs-<env>` execution in the Step Functions console instead of checking the DLQ. Add: "Processing failed. Try again." means the state machine exhausted its retries — the execution's event history shows each attempt's error.
  - `CHANGELOG.md` under `### Changed`: `- All environments run BGM Looper jobs on Step Functions. The SQS queues, dead-letter queues and their alarms are removed (#288).`

- [ ] **Step 4: Commit, PR, apply, merge**

```bash
git add infra/main CHANGELOG.md ARCHITECTURE.md README.md CLAUDE.md docs/runbooks/incident-tool-down.md
git commit -m "chore(infra): run looper jobs on Step Functions everywhere; remove SQS

Closes #288

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin chore/looper-sfn-switch
gh pr create --base dev --title "chore: looper jobs on Step Functions everywhere; remove SQS" --body "Phase 3, PR C of 3. Requires PR A on main (checked, image URIs below). Paste the terraform plan summary here.

Closes #288"
```

With the owner's go-ahead, apply **before** merging, in two steps so no queued job is lost (Review Focus):

1. Switch the notifications only. Stage and main start sending uploads to Step Functions, while their queues and mappings still drain what is already queued:

   ```bash
   cd infra/main && terraform apply -var-file=terraform.tfvars \
     -target='aws_s3_bucket_notification.looper_uploads["main"]' \
     -target='aws_s3_bucket_notification.looper_uploads["stage"]'
   ```

2. Wait until both counts are `0` for `looper-jobs-main` and `looper-jobs-stage`. Dev's queue has had no consumer since PR B, so anything left in it is already stranded; don't wait on it.

   ```bash
   for env in main stage; do
     URL=$(aws sqs get-queue-url --queue-name looper-jobs-$env --query QueueUrl --output text --profile personal --region us-east-1)
     aws sqs get-queue-attributes --queue-url $URL --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --profile personal --region us-east-1
   done
   ```

3. `terraform apply -var-file=terraform.tfvars` for the rest (the destroys), then `terraform plan` shows `No changes.`.

Their deployed Lambda still accepts both shapes throughout. Then merge (touches `lambda/`: alone), deploy dev's Lambda, and repeat Task 4 Step 5 items 1–2 on stage and main after each promotion and deploy.
