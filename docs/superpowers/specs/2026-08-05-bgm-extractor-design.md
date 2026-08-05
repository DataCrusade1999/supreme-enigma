# BGM Extractor — Design Spec

Date: 2026-08-05

## 1. Purpose

Second password-gated tool on the site, at `/tools/bgm-extractor`. Upload an
audio file that has a human voice in the foreground and background music
underneath; get back two separate files — the isolated vocal track and the
isolated background music track. Standalone tool: it does not feed into BGM
Looper or any other tool. Same AWS personal account, same Terraform-managed
kill switch as BGM Looper.

## 2. Architecture

```
Browser
  │  (shared password login — same cookie as BGM Looper)
  ▼
Vercel (Next.js) ── thin API only, never touches raw audio bytes
  │
  ├─ /api/bgm-extractor/upload-url  → presigned S3 PUT URL
  ├─ /api/bgm-extractor/process      → async-invokes AWS Lambda, returns immediately
  └─ /api/bgm-extractor/status       → polled by the browser; HeadObject checks on S3
  │
  ▼
AWS (personal account, provisioned by Terraform)
  ├─ S3 bucket   : SAME bucket BGM Looper already uses (uploads/, outputs/,
  │                 24h lifecycle expiry) — no new bucket
  ├─ Lambda      : NEW, separate container image (torch, torchaudio, demucs)
  │                 — the source-separation pipeline
  └─ IAM role    : SAME lambda_exec role BGM Looper's function already uses
                    (already scoped to this bucket)
```

Mirrors BGM Looper's shape (browser talks to S3 directly for file bytes;
Vercel only handles small JSON) with one structural change: Demucs inference
takes 1–4+ minutes per file on Lambda's CPU-only runtime, far past what a
synchronous Vercel function call should block on, so this tool invokes Lambda
**asynchronously** and the browser **polls** for completion. No new database
or queue — S3 object existence is the status signal (see §5).

## 3. Why a separate Lambda (not added to BGM Looper's)

BGM Looper's image (`librosa`, `numpy`, `soundfile`, `pyloudnorm`, ffmpeg) is
small (~200MB) and fast (~10–20s/run). Demucs needs PyTorch + torchaudio,
pushing the image to an estimated 3–5GB and per-run time to minutes. Bundling
both into one Lambda would permanently bloat BGM Looper's image and cold
starts even when nobody uses the extractor. Kept as two independent
container images / Lambda functions, sharing only the S3 bucket and the IAM
exec role (both already correctly scoped — no new IAM policy needed).

## 4. Processing pipeline (Lambda)

Python container image: `torch`, `torchaudio`, `demucs`, `boto3`.

1. Download the input file from S3 to `/tmp`.
2. Run Demucs's `htdemucs` model with `--two-stems=vocals`. This mode is
   purpose-built for exactly this split — it outputs `vocals.wav` (isolated
   voice) and `no_vocals.wav` (everything else summed back together, i.e.
   the background music). No custom stem-mixing logic needed.
3. Upload both output files to S3 under `outputs/{uuid}/vocals.{ext}` and
   `outputs/{uuid}/instrumental.{ext}` (renamed from Demucs's
   `no_vocals.wav` on upload for a clearer downstream/UI name).
4. On any unhandled exception, upload `outputs/{uuid}/error.json` (see §6
   for why this differs from BGM Looper's error handling).

Model weights (~80MB for `htdemucs`) are baked into the container image at
build time rather than downloaded at cold start — simpler, avoids a
read-only-`/tmp`-caching workaround, and the weight file itself is small
relative to PyTorch's own footprint.

## 5. Data flow (async + polling)

```
Browser →(shared login)→ cookie set (existing auth, unchanged)
Browser →/api/bgm-extractor/upload-url→ Vercel →(presigned PUT)→ S3 uploads/{uuid}.{ext}
Browser →PUT raw file→ S3 directly
Browser →/api/bgm-extractor/process {key}→ Vercel
  Vercel → Lambda InvokeCommand, InvocationType: "Event" (async, fire-and-forget)
  Vercel → returns {jobId: uuid} immediately (no waiting)
  [Lambda runs in the background: download → Demucs → upload both stems, or error.json]
Browser polls /api/bgm-extractor/status?key={uuid} every few seconds:
  Vercel does S3 HeadObject on outputs/{uuid}/vocals.{ext} AND outputs/{uuid}/instrumental.{ext}
    both exist  → {status: "done", vocalsUrl, instrumentalUrl}  (presigned GETs)
    error.json exists → {status: "error", error: <message>}
    neither     → {status: "processing"}
Browser: on "done", render two <audio controls> players + two download links
```

`deriveOutputKey`'s existing 1:1 `uploads/`→`outputs/` prefix swap doesn't
generalize to two output files per input; this tool uses a new
`outputs/{uuid}/` directory convention instead (uuid taken from the input
key, which is already a UUID-named file per `keyForUpload`).

## 6. Error handling — why this differs from BGM Looper

BGM Looper invokes Lambda synchronously and checks the `InvokeCommand`
response's `FunctionError` field directly — an unhandled exception in the
handler is enough. That signal doesn't exist for async (`"Event"`)
invocations: the caller gets a 202 immediately and never learns whether the
function later succeeded or failed. So this handler wraps its body in
`try/except` and explicitly writes an `outputs/{uuid}/error.json` marker
(`{"error": str(e)}`) on failure, which is what the status endpoint checks
for.

Async Lambda invocations also retry automatically (AWS default: up to 2
retries on failure) before this manual error-marker path would even run on
the final attempt. Since retries would otherwise mean the browser polls
through 2 extra silent retry-and-fail cycles before ever seeing an error,
this Lambda's async invoke config sets `MaximumRetryAttempts = 0` — simpler
and more predictable for a single-user tool, at the cost of no automatic
retry on transient failures (acceptable; the user can just re-upload).

Corrupt/unsupported input → same `error.json` path, surfaced as a plain
error message in the UI. No job queue/database — same stateless-by-design
posture as BGM Looper.

## 7. Frontend (`app/app/tools/bgm-extractor/page.tsx`)

Single client component, same shape as BGM Looper's page
(`idle → uploading → processing → done → error`) with one addition: while
`processing`, poll `/api/bgm-extractor/status` on an interval (e.g. every
3–5s) instead of a single blocking fetch, since a run can take minutes.
Show a lightweight indicator (spinner or elapsed-time text) rather than
BGM Looper's static "Processing…" text, since a multi-minute wait with no
feedback reads as broken. On `done`, render both stems as separate
`<audio controls>` players with their own download links, labeled "Vocals"
and "Background Music".

Gated the same way as BGM Looper, via the existing shared-password cookie:
add `/tools/bgm-extractor` and `/api/bgm-extractor` to `GATED_PREFIXES` in
`app/lib/route-gate.ts`. No new auth mechanism.

## 8. Infrastructure as Code (Terraform)

New sibling top-level directory `lambda-demucs/` (mirrors `lambda/`'s
internal structure: `src/`, `tests/`, `Dockerfile`, `requirements.txt`,
`pytest.ini`) — kept as a fully independent Python project, matching this
repo's existing "independent sibling projects" convention.

Terraform changes, following the existing shared-vs-per-branch split:

- **`shared.tf`**: one new `aws_ecr_repository` for the Demucs image, with
  its own lifecycle policy — **keep the last 1–2 images per branch tag
  prefix, not 5**. These images are estimated at 3–5GB each (vs. BGM
  Looper's ~200MB), so the existing keep-5 policy would risk real ECR
  storage cost (see §9). No new IAM role or IAM user — reuses
  `aws_iam_role.lambda_exec` (already scoped to the shared bucket) and the
  existing Vercel/CI IAM users' policies, extended to also cover this new
  function's ARN and this new ECR repo's push permissions (same shape as
  the existing `local.all_lambda_function_arns` pattern, just adding the
  new function name).
- **`environments.tf`**: one new `aws_lambda_function` (main) + one new
  `for_each`-over-`["dev", "stage"]` twin, same pattern as
  `aws_lambda_function.looper` / `.looper_env`, sized independently
  (higher memory — likely 3008MB — and a longer timeout, likely 5–10 min,
  to comfortably fit Demucs's CPU inference time). **No new S3 bucket** —
  points at the same `aws_s3_bucket.audio` / `.audio_env` BGM Looper
  already created. New Vercel env var
  (`DEMUCS_LAMBDA_FUNCTION_NAME`, or similar) added alongside the existing
  `LAMBDA_FUNCTION_NAME`, following the same per-branch override pattern;
  `S3_BUCKET_NAME` is reused as-is.

`terraform destroy` in `infra/main/` continues to be the single kill switch
— it now also tears down the new ECR repo and Lambda functions, same as
everything else in that layer.

## 9. Cost & sizing

- **Lambda compute**: effectively $0/month at personal-project usage. AWS's
  free tier (400,000 GB-seconds/month, never expires) comfortably covers
  this — even a generous estimate (3GB memory × 2 min/run = 360
  GB-seconds/run) allows over 1,100 runs/month for free.
- **ECR storage** is the real cost lever (not compute): at $0.10/GB-month
  with only 500MB free for the first 12 months, an unmanaged multi-GB
  image kept 5-deep across 3 branches could run several hundred INR/month.
  Mitigated by the tighter 1–2-image retention policy in §8 — at, say,
  2 images × 3 branches × ~3.5GB average, that's ~21GB ≈ $2.10/month.
- Combined estimate: comfortably under the ~200 INR/month (~$2.40)
  budget target at single-user, low-volume usage.
- Considered and rejected: moving compute off Lambda to a multi-cloud
  (DigitalOcean) setup. DigitalOcean Functions caps memory at 1GB — too
  tight for PyTorch + Demucs to run reliably. An on-demand DigitalOcean
  Droplet (provisioned per job, destroyed after) could technically fit the
  budget, but adds real orchestration complexity (boot time, custom
  image/snapshot maintenance, API-driven provisioning, a live VM's
  security surface) to solve a cost problem the ECR retention change
  already solves on AWS alone.

## 10. CI/CD

`.github/workflows/deploy.yml`'s `changes`/`deploy` jobs are currently
hardcoded to a single `lambda/` path filter and a single function/image.
Extended (not turned into a matrix, to match this workflow's existing
hand-rolled-over-generic style) with:

- A second `changes` output, path-filtered on `lambda-demucs/` (and this
  workflow file itself), same `git diff --quiet` approach as the existing
  check.
- A duplicated `deploy`-shaped job block (build from `lambda-demucs/`,
  tag `demucs-{branch}-{sha}`, push to the new ECR repo, call
  `aws lambda update-function-code` on the new per-branch function name),
  gated on the new `changes` output.

`test` job gains an equivalent Python test step for `lambda-demucs/`
(`pytest -v` from that directory, its own `requirements.txt` + `pytest`
install) alongside the existing `lambda/` step. Both lambdas' tests run
unconditionally on every push/PR, matching the existing `test` job's
no-path-filtering behavior.

## 11. Testing

- **Python (`lambda-demucs/tests/`)**: reuse the `moto` +
  monkeypatched-`process()` pattern from BGM Looper's `test_handler.py` to
  test the new handler's S3 download/upload orchestration without
  actually running Demucs inference in tests. Add a dedicated test for the
  new `try/except → error.json` path (BGM Looper's handler has no
  equivalent to copy from, since sync invocation didn't need one).
- **Frontend (`page.test.tsx`)**: reuse the `vi.stubGlobal("fetch", ...)` +
  Testing Library pattern from BGM Looper's page test, extended with a
  mocked multi-call polling sequence (`processing` → `processing` →
  `done`) to exercise the new polling loop, plus an `error` case.
- **Manual end-to-end**: run a real voice+music recording through the
  deployed tool and listen to both resulting stems.

## 12. Explicitly out of scope (YAGNI)

- Feeding extracted background music into BGM Looper (standalone tool per
  §1 — revisit only if a real chained-workflow need shows up).
- Multi-cloud / DigitalOcean compute (§9 — AWS-only is cheaper and simpler
  at this scale).
- A job-status database or queue (DynamoDB, SQS, etc.) — S3 object
  existence checks are sufficient at single-user volume.
- Spleeter or any second model choice — Demucs only.
- Configurable stem count (e.g. full 4-stem drums/bass/other/vocals split)
  — `--two-stems=vocals` is exactly the two outputs this tool needs.
- File size/duration limits or client-side validation beyond what Lambda's
  timeout naturally enforces.
