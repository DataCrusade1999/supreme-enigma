# Looper jobs on Step Functions — Design

**Date:** 2026-09-28
**Status:** Approved 2026-09-28. Written without a brainstorming session, at the owner's request; the owner reviewed the §3 decisions afterwards.
**Issue:** #288
**Epic:** #285 (phase 3 of 5). Builds on phases 1 (#286) and 2 (#287) as they stand when complete.

## 1. Problem

After phase 1 the Lambda does two jobs. It runs the DSP pipeline, and it keeps the job's bookkeeping: conditional status writes, telling permanent failures from transient ones, and swallowing duplicate deliveries. That bookkeeping is most of `handler.py`, and a message that exhausts its retries leaves the row stuck at `processing`, so the page can only report a timeout.

## 2. Goals and non-goals

Goals:

- An upload to `uploads/` starts a Step Functions Standard execution, through an S3 → EventBridge rule, one state machine per environment.
- The state machine writes job status straight to DynamoDB with the optimized `dynamodb:updateItem` integration. The Lambda does DSP only.
- Retries and failure handling live in the state machine definition:
  - a rejected file fails at once
  - a transient error is retried twice, and if it still fails the row is written `failed`, so it never stays stuck at `processing`
- The SQS queues, DLQs, event source mappings and the SQS code path are removed.

Non-goals:

- Splitting the DSP pipeline (trim, loop point, crossfade, loudness) into separate Lambda steps. Each step would have to write its audio back to S3 for the next one, which adds latency and code for no benefit to the user. The learning value is in the orchestration, and that doesn't need the split.
- Express workflows. Standard is free at this volume (4,000 transitions a month) and keeps a visual history of every execution, which is most of what makes Step Functions useful to learn.
- Changing the status route or the page, beyond reading the new result attribute.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Trigger | S3 EventBridge notifications (`eventbridge = true`) → an EventBridge rule per env on `Object Created` with key prefix `uploads/` → `StartExecution` | EventBridge can start a state machine directly. The alternative, EventBridge Pipes from the existing queue, keeps SQS but adds a second poller and its cost. |
| Workflow type | Standard | Free tier, execution history, and TestState for trying out a single state. |
| Query language | JSONata | The current recommended language for Step Functions. `$string()` turns the pipeline's metadata into a DynamoDB string without a Lambda. |
| Result storage | New string attribute `resultJson` holding the metadata JSON | The direct DynamoDB integration needs typed AttributeValues. Turning an arbitrary object into those in JSONata is impractical, but storing a string is one expression. `getJobStatus` parses it. |
| Permanent vs transient | The Lambda raises `PipelineRejected` for DSP failures. A retrier with `MaxAttempts: 0` sits before a `States.ALL` retrier. | Step Functions matches a Lambda error by its Python class name. |
| Transient exhaustion | Row written `failed` ("Processing failed. Try again."), then a `Fail` state | For errors that fail fast, the page shows the failure instead of timing out. Retried Lambda timeouts can take about 210s, longer than the page's 120s limit, so those still reach the page as a timeout. The `Fail` state feeds the `ExecutionsFailed` alarm. |
| Key encoding | `keyForUpload` keeps only `[A-Za-z0-9]` in the extension (max 10 chars) | S3 URL-encodes keys in SQS notifications. The EventBridge form isn't clearly documented. Making keys that never need encoding removes the question. |
| Rollout switch | `var.looper_sfn_envs`, default `["dev"]` | The same pattern phase 1 used, so dev runs on Step Functions while stage and main stay on SQS. |

## 4. State machine

One per environment, `looper-jobs-<env>`. Input `{ "bucket": "...", "key": "uploads/<uuid>.<ext>" }` comes from the rule's input transformer.

```
MarkProcessing (dynamodb:updateItem, condition: no status or processing)
   ├─ ConditionalCheckFailed → AlreadyFinished (Succeed)
   ▼
Process (lambda:invoke → { outputKey, meta })
   Retry: PipelineRejected ×0; States.ALL ×2, 10s, backoff 2
   ├─ PipelineRejected → MarkRejected (failed, FAILED_MESSAGE) → end
   ├─ States.ALL → MarkErrored (failed, "Processing failed. Try again.") → Failed (Fail)
   ▼
MarkDone (dynamodb:updateItem, condition: processing; outputKey, resultJson)
   └─ ConditionalCheckFailed → AlreadyFinished
```

Every Mark* write sets `updatedAt` (`$now()`) and `expiresAt` (now + 86400, as a DynamoDB `N`). The conditions match phase 1's: a finished row never changes. So when EventBridge delivers the same event twice, the second execution ends in `AlreadyFinished`.

Executions log at `ERROR` level to `/aws/vendedlogs/states/looper-jobs-<env>` (14-day retention), with X-Ray tracing on. That links the phase 2 Lambda trace under the execution.

`TimeoutSeconds = 600` on the whole state machine.

## 5. Lambda

The handler takes `{bucket, key}` and returns `{"outputKey", "meta"}`:
- A DSP failure raises `PipelineRejected`.
- An S3 error propagates, so the state machine retries it.
- Phase 2's Powertools logging, the `JobSucceeded`/`JobRejected` metrics and the `job finished` line stay. A duplicate execution that loses the `MarkDone` race can now count one extra `JobSucceeded`. That's accepted: it needs a duplicate EventBridge delivery, which is rare.

The Lambda loses its DynamoDB code, its `JOBS_TABLE_NAME` variable and its SQS and DynamoDB permissions.

## 6. Infrastructure

Added:
- `aws_sfn_state_machine.looper` for each env.
- One shared state-machine role: `UpdateItem` on the three tables, `InvokeFunction` on the three functions, log delivery, X-Ray.
- Per env: `aws_cloudwatch_event_rule.looper_uploads` and a target with an input transformer and retry policy (3 attempts, 1 hour).
- One shared EventBridge role with `states:StartExecution`.
- Per env: an execution log group, and an `ExecutionsFailed > 0` alarm to the existing SNS topic.

Changed:
- `aws_s3_bucket_notification.looper_uploads` sends to EventBridge for envs in `looper_sfn_envs`, and to the queue for the rest.
- The dashboard's DLQ series becomes `ExecutionsFailed`.

Removed once all envs switch:
- SQS queues and DLQs, queue policies, event source mappings, DLQ alarms
- `aws_iam_role_policy.lambda_jobs`, the Lambda's `JOBS_TABLE_NAME`
- `var.looper_sfn_envs`

`eventbridge = true` sends every event from the bucket to the default bus, including resume and News Desk writes. That's free for AWS service events, and the rule's prefix filter ignores them.

## 7. Rollout

1. **PR A (Lambda and web).**
   - The Lambda accepts the Step Functions input as well as SQS records.
   - `getJobStatus` reads `resultJson` as well as `result`.
   - `keyForUpload` cleans extensions.

   Promoted to main, and each Lambda deployed.
2. **PR B (infra).** Adds everything in §6 for all envs, with `looper_sfn_envs = ["dev"]`. Test on dev.
3. **PR C (switch and clean up).** Requires PR A on main.
   - Sets all envs to Step Functions and applies. Stage and main switch at apply time, and their Lambda already accepts the input.
   - Then removes the SQS resources and code, the `result` fallback and the variable.

## 8. Testing

- **Lambda (pytest, moto S3):**
  - returns `outputKey` and `meta` and uploads the output
  - raises `PipelineRejected` on a DSP failure and still flushes `JobRejected`
  - raises the S3 `ClientError` on a missing object
- **Web (Vitest):**
  - `getJobStatus` parses `resultJson`
  - `keyForUpload` cleans extensions (`"take.final mix"` → `.finalmix`, `"a.WAV"` → `.WAV`, `"noext"` → no extension)
- **State machine:**
  - `aws stepfunctions validate-state-machine-definition` on the rendered definition before applying
  - after apply, `aws stepfunctions test-state` on `MarkProcessing` against dev's table
  - manual runs on dev: a good clip, a non-audio file (`MarkRejected`, no retries), and a start-execution for a key with no object (two retries, then `MarkErrored` and `Failed`, with the alarm email)

## 9. Cost

- Step Functions Standard is $0.025 per 1,000 transitions after 4,000 free a month. A job takes about 4 transitions, so the free tier covers about 1,000 jobs a month.
- S3 events on the default EventBridge bus are free.
- Removing SQS removes phase 1's idle polling cost of about $0.40 a month.

Net effect: this phase lowers the monthly bill.
