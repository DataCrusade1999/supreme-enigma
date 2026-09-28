# Looper async jobs — Design

**Date:** 2026-09-28
**Status:** Approved 2026-09-28
**Issue:** #286
**Epic:** #285 (phase 1 of 5)

## 1. Problem

The owner wants to learn AWS event-driven services on a real flow. The BGM Looper is the fit: today `/api/looper/process` invokes the DSP Lambda synchronously (`InvocationType: "RequestResponse"`, 60s timeout) and waits for the loop metadata in the response.

That flow works. This phase replaces it for the learning value, and accepts its main cost: the page has to poll for a result instead of getting one response.

## 2. Goals and non-goals

Goals:

- An upload to `uploads/` starts processing on its own, through S3 event notifications and SQS.
- Job status (`queued`, `processing`, `done`, `failed`) lives in DynamoDB and the page polls it.
- Messages that keep failing land in a dead-letter queue (DLQ), and an alarm emails the owner.
- Each environment (`main`, `dev`, `stage`) gets its own queue, DLQ and table, like its bucket and Lambda.

Non-goals:

- Changing the DSP code in `lambda/src/looper/pipeline.py`.
- A Playwright spec for the looper. There is none today, and a real run needs live AWS.
- Push updates (WebSockets, SSE). Polling only.
- Step Functions. That is phase 3, which replaces the SQS → Lambda link built here.

## 3. Architecture

```
browser ──PUT (presigned)──▶ S3 uploads/<uuid>.<ext>
                                  │ ObjectCreated (prefix uploads/)
                                  ▼
                            SQS looper-jobs-<env> ──(3 receives)──▶ SQS looper-jobs-dlq-<env>
                                  │ event source mapping, batch size 1
                                  ▼
                            Lambda (existing function)
                              ├─ DynamoDB: status=processing
                              ├─ S3 outputs/<uuid>.<ext>
                              └─ DynamoDB: status=done + metadata  (or failed + reason)
browser ──poll every 2s──▶ GET /api/looper/status?key=… ──▶ DynamoDB GetItem
                              └─ when done: presigned download URL + metadata
```

`/api/looper/upload-url` is unchanged. It does not write a DynamoDB row: a missing row reads as `queued`.

## 4. AWS resources

All per-environment resources go in `infra/main/environments.tf`, keyed `main`/`dev`/`stage` like `aws_s3_bucket.data`.

| Resource | Settings |
|---|---|
| `aws_sqs_queue` `looper_jobs` | Visibility timeout 360s (6× the Lambda's 60s timeout, AWS's recommended ratio). Redrive policy to the DLQ with `maxReceiveCount = 3`. |
| `aws_sqs_queue` `looper_jobs_dlq` | Retention 14 days, so a failed message can be inspected. |
| `aws_sqs_queue_policy` | Allows `s3.amazonaws.com` to `sqs:SendMessage`, conditioned on `aws:SourceArn` = that environment's bucket and `aws:SourceAccount`. |
| `aws_dynamodb_table` `looper_jobs` | Name `looper-jobs-<env>`, partition key `jobKey` (string), `PAY_PER_REQUEST`, TTL on `expiresAt`. |
| `aws_cloudwatch_metric_alarm` | `ApproximateNumberOfMessagesVisible > 0` on the DLQ, action to the existing `aws_sns_topic.budget_alerts`. |
| `aws_s3_bucket_notification` | `s3:ObjectCreated:*`, filter prefix `uploads/`, target the queue. **Only for envs in `looper_async_envs`.** |
| `aws_lambda_event_source_mapping` | Queue → that env's Lambda, `batch_size = 1`, `scaling_config.maximum_concurrency = 2`. **Only for envs in `looper_async_envs`.** |

The `uploads/` prefix filter is required: the same buckets hold resume and News Desk data, which must never reach the pipeline.

A bucket takes only one `aws_s3_bucket_notification` resource. None exists today; any later notification has to be added to this one.

New variable in `infra/main/variables.tf`: `looper_async_envs` (`list(string)`, default `[]`). It exists only for the rollout (§7) and is removed at the end.

IAM changes in `infra/main/shared.tf`:

- `lambda_exec` role: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` on the three job queues; `dynamodb:UpdateItem` on the three tables.
- `vercel` role: `dynamodb:GetItem` on the three tables. `lambda:InvokeFunction` is removed in the cleanup PR.

The Lambda gets a new env var, `JOBS_TABLE_NAME`. Vercel gets `JOBS_TABLE_NAME` through the same `git_branch`-scoped overrides as `S3_BUCKET_NAME`.

## 5. DynamoDB item

| Attribute | Type | Set when |
|---|---|---|
| `jobKey` | S | Always. The upload key, e.g. `uploads/<uuid>.wav`. |
| `status` | S | `processing`, `done` or `failed`. |
| `outputKey` | S | `done`. |
| `result` | M | `done`. The metadata `process()` returns today (peaks, tempo, loop decisions), stored as-is. |
| `error` | S | `failed`. A short reason safe to show on the page. |
| `updatedAt` | S | Every write. ISO timestamp. |
| `expiresAt` | N | Every write. Epoch seconds, now + 1 day, matching the S3 expiry rule. |

Every write is an `UpdateItem` with the condition `attribute_not_exists(#s) OR #s = :processing`. A row that has reached `done` or `failed` is never changed, so a duplicate SQS delivery cannot move a finished job back to `processing`. A `ConditionalCheckFailedException` means a duplicate delivery; the handler logs it and returns without processing.

Float values in `result` go through `Decimal` before the write, because boto3's DynamoDB serializer rejects Python floats.

## 6. Lambda handler

`lambda/src/looper/handler.py` changes; `pipeline.py` does not.

For each SQS record:

1. Parse the body as an S3 event. A body with `"Event": "s3:TestEvent"` (sent once when the notification is created) is skipped.
2. Read bucket and key, and URL-decode the key (`urllib.parse.unquote_plus`). S3 encodes keys in events.
3. Derive `output_key` by swapping the `uploads/` prefix for `outputs/`, as `deriveOutputKey` does in the web app today.
4. Write `status=processing`.
5. Download, run `process()`, upload.
6. Write `status=done` with `outputKey` and `result`.

### Failure handling

| Kind | Where it's raised | What happens |
|---|---|---|
| Permanent | Inside `process()`, e.g. audio that can't be decoded | Caught. Row written as `failed` with a reason. The handler returns normally, so SQS deletes the message and does not retry. |
| Transient | Around `process()`: S3 download or upload, DynamoDB write, Lambda timeout | Raised. SQS redelivers after the visibility timeout. After 3 receives the message moves to the DLQ. |

A job that lands in the DLQ leaves its row at `processing`. The page's overall timeout (§8) reports it, and the DLQ alarm emails the owner.

With `batch_size = 1` there is no partial-batch handling to do.

## 7. Rollout

Terraform applies all three environments in one `apply`, but Lambda code reaches `main` only after promotion. Enabling the SQS trigger everywhere at once would send S3 events to `main`'s old handler, which would fail on every message and fill its DLQ. So the work is four PRs:

1. **Lambda.** The handler accepts both event types: the current direct-invoke payload (`bucket`/`input_key`/`output_key`) and SQS records. Direct invokes behave exactly as today and write no DynamoDB rows. Promoted `dev → stage → main` as usual. No behaviour change.
2. **Terraform.** All resources in §4, with the notification and event source mapping created only for envs in `looper_async_envs`, set to `["dev"]`. From here, dev processes each upload twice (once by `/process`, once by the event). The output is the same both times.
3. **Web.** Adds `/api/looper/status` and polling, and deletes `/api/looper/process`. Before this PR reaches `stage` and then `main`, that env is added to `looper_async_envs` and applied.
4. **Cleanup.** Removes the direct-invoke path and its test from the handler, `lambda:InvokeFunction` from the `vercel` role, and `looper_async_envs`. The notification and mapping then exist for all three envs.

Each Terraform PR runs `terraform plan` against real state before merge, as the repo requires.

## 8. Web

### `lib/looper`

`getJobStatus(key)` reads the row with `GetItem` and returns one of:

- `{ status: "queued" }` when there is no row
- `{ status: "processing" }`
- `{ status: "failed", error }`
- `{ status: "done", outputKey, result }`

The DynamoDB client lives in `lib/aws.ts` next to the S3 client and uses the same `awsCredentials()`.

### `GET /api/looper/status?key=…`

- 400 unless `key` matches `^uploads/[0-9a-f-]{36}(\.[A-Za-z0-9]+)?$`, the shape `keyForUpload` produces. This also stops a caller from reading arbitrary rows.
- For `done`: presigns the download URL and returns the same `LoopResult` shape `/process` returns today (`toLoopResult`), so the result view does not change.
- Otherwise: returns `{ status }`, plus `error` for `failed`.

### Polling

The polling logic is a pure function (in `lib/looper`) that takes the elapsed time and the latest status and returns the next action:

- Poll every 2s.
- Stop on `done` or `failed`.
- Time out after 60s while still `queued`, since the event never arrived.
- Time out after 120s overall, which covers a job stuck at `processing` or sent to the DLQ.

The page shows "Queued", "Processing", the result, or an error with a retry. Retry re-uploads the file, since a new upload is a new job.

## 9. Testing

Lambda (`lambda/tests/test_handler.py`, pytest + `moto` for S3 and DynamoDB):

- An SQS-wrapped S3 event processes the file, writes the output, and leaves the row `done` with the metadata.
- A URL-encoded key is decoded before the download.
- An `s3:TestEvent` is skipped and writes no row.
- A permanent failure (fake `process` raises) leaves the row `failed` and the handler returns normally.
- A transient failure (download fails) raises.
- A duplicate delivery against a `done` row does not change it and does not reprocess.
- The direct-invoke payload still works. Added in PR 1, removed in PR 4.

Web (Vitest, `vi.mock("@/lib/aws")` as in `resume-content.test.ts`):

- `getJobStatus` maps each row state, including a missing row to `queued`.
- `/api/looper/status` returns 400 for a missing or malformed key, a download URL only for `done`, and `error` for `failed`.
- The polling function stops on `done` and `failed` and times out at 60s queued and 120s overall.

Manual, per environment after it is enabled: upload a clip and watch the row change in the DynamoDB console; send a malformed message to the queue by hand and confirm it reaches the DLQ after 3 receives and the alarm email arrives.

## 10. Cost

DynamoDB on-demand (25 GB always free; reads and writes cost fractions of a cent) and CloudWatch (10 alarms free, this adds three) stay inside the free tier.

SQS is the one real cost, and it comes from idle polling, not traffic. An event source mapping long-polls with five connections at 20s each: about 650k requests per queue per month, so about 1.9M for three queues against 1M free. The excess is about $0.40/month (≈ ₹38 at ₹95.92/USD, the 2026-09-26 rate used in the News Desk spec), and it starts accruing per env as that env joins `looper_async_envs`. The existing `aws_budgets_budget` covers it. Nothing bills by the hour.
