# BGM Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a second password-gated tool, at `/tools/bgm-extractor`, that takes an uploaded audio file with a voice over background music and returns two separate files — isolated vocals and isolated background music — using Demucs on a new, independent AWS Lambda.

**Architecture:** Mirrors BGM Looper's shape (browser ↔ S3 direct for file bytes, Vercel API routes as thin orchestration) with one structural difference: Demucs inference takes minutes, not seconds, so the Vercel `process` route invokes the new Lambda **asynchronously** and returns immediately, and the browser **polls** a `status` route that checks S3 object existence (no database/queue). The new Lambda is a separate container image/function (`lambda-demucs/`) — PyTorch + Demucs is too heavy to bundle into BGM Looper's existing fast image — but it reuses BGM Looper's existing S3 bucket, `lambda_exec` IAM role, Vercel project, and both shared service-account IAM users (extended, not duplicated).

**Tech Stack:** Python 3.12 + Demucs (CLI, invoked via `subprocess`) + boto3 in a new Lambda container image; Next.js API routes (TypeScript) for upload/process/status; Terraform additions to the existing `infra/main` layer; GitHub Actions additions to the existing `deploy.yml`.

## Global Constraints

- Model: Demucs `htdemucs`, invoked with `--two-stems=vocals` (produces exactly `vocals.wav` + `no_vocals.wav` — no custom stem-mixing).
- Output objects are always named `outputs/{uuid}/vocals.wav` and `outputs/{uuid}/instrumental.wav` — fixed `.wav`, regardless of the input file's format (Demucs's CLI only writes `.wav` or `.mp3`; WAV preserves quality and needs no extra transcode step).
- Lambda invocation from Vercel: async (`InvocationType: "Event"`), not sync — processing takes 1–4+ minutes. `MaximumRetryAttempts = 0` on the function's event-invoke config (predictable single-shot behavior; a failed run's `error.json` marker only gets written once, not after 2 silent retries).
- Failure signaling (since async invokes give the caller no `FunctionError`): the handler `try/except`s its body and uploads `outputs/{uuid}/error.json` (`{"error": str(e)}`) on any exception, then re-raises (so CloudWatch still records the failure).
- Status polling: browser polls `GET /api/bgm-extractor/status?jobId={uuid}` every 3000ms. No database — status is derived purely from S3 `HeadObject` checks (`error.json` present → `error`; both stem files present → `done`; otherwise → `processing`).
- Lambda sizing: 3008MB memory, 600s (10 min) timeout, container image (`package_type = "Image"`).
- Model weights baked into the image at build time: `ENV TORCH_HOME=/opt/torch_cache` set before a build-time `RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')"`, so no download happens on first real invocation.
- `torch`/`torchaudio` installed CPU-only via `--extra-index-url https://download.pytorch.org/whl/cpu` in `requirements.txt` (avoids pulling CUDA wheels, which would bloat the image far past what's needed on Lambda's CPU-only runtime).
- New Lambda function names: `bgm-looper-demucs-processor` (main), `-dev`, `-stage` (twins) — mirrors `bgm-looper-processor`'s existing per-branch naming.
- New ECR repo: `bgm-looper-demucs-lambda`, lifecycle policy keeps only the **1** most recent image per branch tag prefix (not BGM Looper's 5) — this image is estimated at 3–5GB vs. BGM Looper's ~200MB, so a smaller retention count keeps ECR storage cost low (see the design spec §9 for the cost math). Trade-off: no rollback via ECR on a bad deploy (a fresh CI rebuild from git history is the recovery path) — acceptable for a personal, low-frequency-deploy tool.
- No new S3 bucket, no new Lambda execution IAM role, no new Vercel project, no new CI-deploy/Vercel-SA IAM users — this tool extends BGM Looper's existing shared ones.
- Auth: reuses the existing single shared-password cookie/gate exactly as-is. `/tools/bgm-extractor` and `/api/bgm-extractor` are added to `GATED_PREFIXES` in `app/lib/route-gate.ts`. No new login page (unauthenticated visits redirect to the existing `/tools/bgm-looper/login?next=...`, which already round-trips back to any `next` path on success).
- Python package name: `extractor` (mirrors BGM Looper's `looper` package — the tool's short name, not `bgm-extractor` verbatim, since hyphens aren't valid in Python identifiers).
- CI test job for `lambda-demucs/` installs only `boto3 pytest moto` — **not** the full `requirements.txt`. The Python code never `import`s `torch`/`torchaudio`/`demucs` (it shells out to the `demucs` CLI via `subprocess`, matching how `lambda/`'s pipeline shells out to `ffmpeg`), and every test mocks that `subprocess` call — so CI never needs to install multi-gigabyte ML wheels just to run these tests. The heavy `requirements.txt` is only installed inside the Docker image build (which does need the real `demucs` CLI at runtime).

---

### Task 1: Demucs invocation wrapper (`separate`)

**Files:**
- Create: `lambda-demucs/src/extractor/__init__.py`, `lambda-demucs/src/extractor/separate.py`
- Create: `lambda-demucs/pytest.ini`, `lambda-demucs/tests/__init__.py` (empty)
- Test: `lambda-demucs/tests/test_separate.py`

**Interfaces:**
- Produces: `separate(input_path: str, output_dir: str, model: str = "htdemucs") -> tuple[str, str]` — runs `demucs -n {model} --two-stems=vocals -o {output_dir} {input_path}` via `subprocess.run`, then returns `(vocals_path, instrumental_path)` pointing at the two files Demucs wrote under `{output_dir}/{model}/{basename}/`. Raises `FileNotFoundError` if either expected output file is missing after the subprocess call. Task 2's `handler.py` imports and calls this directly.

- [ ] **Step 1: Write the failing tests**

`lambda-demucs/pytest.ini`:
```ini
[pytest]
pythonpath = src
```

`lambda-demucs/src/extractor/__init__.py`: empty file.

`lambda-demucs/tests/__init__.py`: empty file.

`lambda-demucs/tests/test_separate.py`:
```python
import os
import subprocess

from extractor.separate import separate


def test_separate_invokes_demucs_and_returns_stem_paths(tmp_path, monkeypatch):
    input_path = str(tmp_path / "input.wav")
    with open(input_path, "wb") as f:
        f.write(b"fake-audio-bytes")
    output_dir = str(tmp_path / "out")

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        stem_dir = os.path.join(output_dir, "htdemucs", "input")
        os.makedirs(stem_dir, exist_ok=True)
        with open(os.path.join(stem_dir, "vocals.wav"), "wb") as f:
            f.write(b"vocals")
        with open(os.path.join(stem_dir, "no_vocals.wav"), "wb") as f:
            f.write(b"instrumental")

    monkeypatch.setattr(subprocess, "run", fake_run)

    vocals_path, instrumental_path = separate(input_path, output_dir)

    assert captured["cmd"] == [
        "demucs",
        "-n",
        "htdemucs",
        "--two-stems=vocals",
        "-o",
        output_dir,
        input_path,
    ]
    assert vocals_path == os.path.join(output_dir, "htdemucs", "input", "vocals.wav")
    assert instrumental_path == os.path.join(output_dir, "htdemucs", "input", "no_vocals.wav")
    assert os.path.exists(vocals_path)
    assert os.path.exists(instrumental_path)


def test_separate_raises_if_demucs_produced_no_output(tmp_path, monkeypatch):
    input_path = str(tmp_path / "input.wav")
    with open(input_path, "wb") as f:
        f.write(b"fake-audio-bytes")
    output_dir = str(tmp_path / "out")

    def fake_run(cmd, **kwargs):
        pass  # simulate demucs "succeeding" but writing nothing

    monkeypatch.setattr(subprocess, "run", fake_run)

    try:
        separate(input_path, output_dir)
        assert False, "expected FileNotFoundError"
    except FileNotFoundError:
        pass
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd lambda-demucs && pip install pytest && pytest tests/test_separate.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'extractor.separate'`

- [ ] **Step 3: Write minimal implementation**

`lambda-demucs/src/extractor/separate.py`:
```python
import os
import subprocess


def separate(input_path: str, output_dir: str, model: str = "htdemucs") -> tuple[str, str]:
    subprocess.run(
        ["demucs", "-n", model, "--two-stems=vocals", "-o", output_dir, input_path],
        check=True,
        capture_output=True,
    )

    basename = os.path.splitext(os.path.basename(input_path))[0]
    stem_dir = os.path.join(output_dir, model, basename)
    vocals_path = os.path.join(stem_dir, "vocals.wav")
    instrumental_path = os.path.join(stem_dir, "no_vocals.wav")

    if not os.path.exists(vocals_path) or not os.path.exists(instrumental_path):
        raise FileNotFoundError(f"demucs did not produce expected output in {stem_dir}")

    return vocals_path, instrumental_path
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd lambda-demucs && pytest tests/test_separate.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lambda-demucs/pytest.ini lambda-demucs/src/extractor/__init__.py lambda-demucs/src/extractor/separate.py lambda-demucs/tests/__init__.py lambda-demucs/tests/test_separate.py
git commit -m "feat(lambda-demucs): add demucs CLI invocation wrapper"
```

---

### Task 2: Lambda handler (S3 orchestration + error marker)

**Files:**
- Create: `lambda-demucs/src/extractor/handler.py`
- Create: `lambda-demucs/tests/conftest.py`
- Test: `lambda-demucs/tests/test_handler.py`

**Interfaces:**
- Consumes: `separate(input_path, output_dir, model="htdemucs") -> tuple[str, str]` (Task 1).
- Produces: `handler(event: dict, context) -> dict` — `event` shape `{"bucket": str, "input_key": str, "output_prefix": str}`, returns `{"vocals_key": str, "instrumental_key": str}` on success. On any exception, uploads `{output_prefix}/error.json` to the same bucket and re-raises. This exact `event`/return contract is what the Terraform-provisioned Lambda and the `/api/bgm-extractor/process` + `/status` routes (Task 5) both rely on.

- [ ] **Step 1: Write the failing tests**

`lambda-demucs/tests/conftest.py`:
```python
import os

# Set dummy AWS credentials at module import time (not inside a fixture):
# extractor.handler builds its S3 client at module scope, and pytest imports
# test_handler.py (which imports extractor.handler) during collection, before
# any fixture would run. A fixture-based env var set would arrive too late
# for that module-level client, so this must execute at conftest import time.
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ["AWS_SECURITY_TOKEN"] = "testing"
os.environ["AWS_SESSION_TOKEN"] = "testing"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
```

`lambda-demucs/tests/test_handler.py`:
```python
import json

import boto3
from moto import mock_aws

from extractor import handler as handler_module


@mock_aws
def test_handler_downloads_separates_and_uploads_both_stems(monkeypatch, tmp_path):
    monkeypatch.setattr(handler_module, "TMP_DIR", str(tmp_path))

    bucket = "test-bucket"
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=bucket)
    s3.put_object(Bucket=bucket, Key="uploads/abc.wav", Body=b"fake-audio-bytes")

    def fake_separate(input_path, output_dir, model="htdemucs"):
        vocals_path = str(tmp_path / "vocals.wav")
        instrumental_path = str(tmp_path / "instrumental.wav")
        with open(vocals_path, "wb") as f:
            f.write(b"vocals-bytes")
        with open(instrumental_path, "wb") as f:
            f.write(b"instrumental-bytes")
        return vocals_path, instrumental_path

    monkeypatch.setattr(handler_module, "separate", fake_separate)

    result = handler_module.handler(
        {"bucket": bucket, "input_key": "uploads/abc.wav", "output_prefix": "outputs/abc"},
        None,
    )

    assert result == {
        "vocals_key": "outputs/abc/vocals.wav",
        "instrumental_key": "outputs/abc/instrumental.wav",
    }
    vocals_body = s3.get_object(Bucket=bucket, Key="outputs/abc/vocals.wav")["Body"].read()
    instrumental_body = s3.get_object(Bucket=bucket, Key="outputs/abc/instrumental.wav")["Body"].read()
    assert vocals_body == b"vocals-bytes"
    assert instrumental_body == b"instrumental-bytes"


@mock_aws
def test_handler_writes_error_marker_and_reraises_on_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(handler_module, "TMP_DIR", str(tmp_path))

    bucket = "test-bucket"
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=bucket)
    s3.put_object(Bucket=bucket, Key="uploads/abc.wav", Body=b"fake-audio-bytes")

    def failing_separate(input_path, output_dir, model="htdemucs"):
        raise RuntimeError("demucs blew up")

    monkeypatch.setattr(handler_module, "separate", failing_separate)

    try:
        handler_module.handler(
            {"bucket": bucket, "input_key": "uploads/abc.wav", "output_prefix": "outputs/abc"},
            None,
        )
        assert False, "expected RuntimeError to propagate"
    except RuntimeError:
        pass

    error_body = s3.get_object(Bucket=bucket, Key="outputs/abc/error.json")["Body"].read()
    assert json.loads(error_body) == {"error": "demucs blew up"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd lambda-demucs && pip install boto3 pytest moto && pytest tests/test_handler.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'extractor.handler'`

- [ ] **Step 3: Write minimal implementation**

`lambda-demucs/src/extractor/handler.py`:
```python
import json
import os

import boto3

from extractor.separate import separate

s3 = boto3.client("s3")

TMP_DIR = "/tmp"


def handler(event: dict, context) -> dict:
    bucket = event["bucket"]
    input_key = event["input_key"]
    output_prefix = event["output_prefix"]

    ext = os.path.splitext(input_key)[1]
    input_path = os.path.join(TMP_DIR, f"input{ext}")
    output_dir = os.path.join(TMP_DIR, "output")

    try:
        s3.download_file(bucket, input_key, input_path)
        vocals_path, instrumental_path = separate(input_path, output_dir)

        vocals_key = f"{output_prefix}/vocals.wav"
        instrumental_key = f"{output_prefix}/instrumental.wav"
        s3.upload_file(vocals_path, bucket, vocals_key)
        s3.upload_file(instrumental_path, bucket, instrumental_key)

        return {"vocals_key": vocals_key, "instrumental_key": instrumental_key}
    except Exception as e:
        # Async ("Event") invocations never return FunctionError to the caller,
        # so the status endpoint needs an explicit marker to detect failure.
        s3.put_object(
            Bucket=bucket,
            Key=f"{output_prefix}/error.json",
            Body=json.dumps({"error": str(e)}).encode(),
        )
        raise
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd lambda-demucs && pytest tests/test_handler.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lambda-demucs/src/extractor/handler.py lambda-demucs/tests/conftest.py lambda-demucs/tests/test_handler.py
git commit -m "feat(lambda-demucs): add S3-wired handler with error marker on failure"
```

---

### Task 3: Lambda container image

**Files:**
- Create: `lambda-demucs/requirements.txt`, `lambda-demucs/Dockerfile`

**Interfaces:**
- Consumes: `lambda-demucs/src/extractor/` package (Tasks 1–2).
- Produces: a Dockerfile with `extractor.handler.handler` as the Lambda entrypoint — Task 9's GitHub Actions workflow is what actually builds and pushes this image to ECR. A local Docker build is optional here (not required to proceed): this image is large (PyTorch + Demucs), so a local build would be slow — CI is the authoritative build/verify step, same convention as BGM Looper's Dockerfile task.

- [ ] **Step 1: Write requirements.txt**

`lambda-demucs/requirements.txt`:
```
--extra-index-url https://download.pytorch.org/whl/cpu
torch>=2.1,<2.3
torchaudio>=2.1,<2.3
demucs>=4.0,<5.0
boto3>=1.34,<2.0
```

- [ ] **Step 2: Write the Dockerfile**

`lambda-demucs/Dockerfile`:
```dockerfile
FROM public.ecr.aws/lambda/python:3.12

RUN dnf install -y tar xz && \
    curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ffmpeg.tar.xz && \
    tar -xf /tmp/ffmpeg.tar.xz -C /tmp && \
    cp /tmp/ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ffmpeg && \
    rm -rf /tmp/ffmpeg*

COPY requirements.txt .
RUN pip install -r requirements.txt

ENV TORCH_HOME=/opt/torch_cache
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')"

COPY src/extractor ${LAMBDA_TASK_ROOT}/extractor

CMD ["extractor.handler.handler"]
```

`ffmpeg` is installed the same way as BGM Looper's Dockerfile — Demucs relies on it (via torchaudio) to decode non-WAV input formats like MP3. `TORCH_HOME` is set before the pre-download `RUN` so the `htdemucs` weights land at `/opt/torch_cache/hub/checkpoints/` inside the image layer; keeping the same `ENV TORCH_HOME` means the runtime process finds them there too, with no download on first real invocation.

- [ ] **Step 3: Structural review (no Docker required)**

Read through the Dockerfile and confirm: the base image tag matches `lambda/Dockerfile`'s (`public.ecr.aws/lambda/python:3.12`); the `COPY src/extractor ...` path matches the package layout from Tasks 1–2 (`lambda-demucs/src/extractor/`); the `CMD` module path (`extractor.handler.handler`) matches Task 2's `handler.py` location and function name exactly.

- [ ] **Step 4: (Optional) local build sanity-check**

Skip this step if Docker is slow/unavailable, or if disk space is limited — this image is multi-gigabyte and Task 9's CI run is the authoritative build. If you do want to check locally:

Run (optional): `cd lambda-demucs && docker build -t bgm-looper-demucs-lambda:local .`
Expected: build succeeds with no errors (will take several minutes and download several GB on first run).

- [ ] **Step 5: Commit**

```bash
git add lambda-demucs/requirements.txt lambda-demucs/Dockerfile
git commit -m "feat(lambda-demucs): add container image for Lambda deployment"
```

---

### Task 4: `app/lib/aws.ts` additions — output-prefix derivation + object-existence check

**Files:**
- Modify: `app/lib/aws.ts`, `app/lib/aws.test.ts`

**Interfaces:**
- Consumes: `getS3Client()` (existing, `app/lib/aws.ts:5`).
- Produces: `deriveOutputPrefix(inputKey: string): string` — strips the extension and swaps `uploads/` for `outputs/` (e.g. `"uploads/abc-123.mp3"` → `"outputs/abc-123"`). `objectExists(key: string): Promise<boolean>` — `true`/`false` via S3 `HeadObject`. Task 5's three new API routes both import these.

- [ ] **Step 1: Write the failing test for `deriveOutputPrefix`**

Add to `app/lib/aws.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { keyForUpload, deriveOutputKey, deriveOutputPrefix } from "./aws";

// ... existing keyForUpload/deriveOutputKey describe blocks stay unchanged ...

describe("deriveOutputPrefix", () => {
  it("swaps the uploads/ prefix for outputs/ and strips the extension", () => {
    expect(deriveOutputPrefix("uploads/abc-123.mp3")).toBe("outputs/abc-123");
  });

  it("handles keys with no extension", () => {
    expect(deriveOutputPrefix("uploads/abc-123")).toBe("outputs/abc-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- aws.test.ts`
Expected: FAIL — `deriveOutputPrefix` is not exported from `./aws`

- [ ] **Step 3: Write minimal implementation**

Add to `app/lib/aws.ts` (after the existing `deriveOutputKey` function):
```typescript
import { HeadObjectCommand } from "@aws-sdk/client-s3";

export function deriveOutputPrefix(inputKey: string): string {
  const withoutExt = inputKey.replace(/\.[^/.]+$/, "");
  return withoutExt.replace(/^uploads\//, "outputs/");
}

export async function objectExists(key: string): Promise<boolean> {
  const client = getS3Client();
  try {
    await client.send(
      new HeadObjectCommand({ Bucket: process.env.S3_BUCKET_NAME!, Key: key }),
    );
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "NotFound") {
      return false;
    }
    throw err;
  }
}
```

Note: also add `HeadObjectCommand` to the existing `@aws-sdk/client-s3` import at the top of the file (`import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";`) rather than as a second import statement — the inline `import` shown above is split out here only for readability; consolidate it with the existing import line.

`objectExists` isn't unit-tested here, matching this codebase's existing convention: `presignUpload`/`presignDownload` (the other AWS-SDK-calling functions in this file) aren't unit-tested either, only the pure-logic helpers are (`app/lib/aws.test.ts`'s existing tests cover only `keyForUpload`/`deriveOutputKey`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- aws.test.ts`
Expected: PASS (all `aws.test.ts` tests, including the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add app/lib/aws.ts app/lib/aws.test.ts
git commit -m "feat(app): add deriveOutputPrefix and objectExists helpers"
```

---

### Task 5: BGM Extractor API routes (upload-url, process, status)

**Files:**
- Create: `app/app/api/bgm-extractor/upload-url/route.ts`
- Create: `app/app/api/bgm-extractor/process/route.ts`
- Create: `app/app/api/bgm-extractor/status/route.ts`

**Interfaces:**
- Consumes: `keyForUpload`, `presignUpload`, `presignDownload` (existing, `app/lib/aws.ts`), `deriveOutputPrefix`, `objectExists` (Task 4). Reads `process.env.DEMUCS_LAMBDA_FUNCTION_NAME` (new Vercel env var, set in Task 10) and the existing `process.env.S3_BUCKET_NAME` / `process.env.APP_AWS_REGION`.
- Produces: `POST /api/bgm-extractor/upload-url` → `{key, uploadUrl}` (identical shape to the existing looper route). `POST /api/bgm-extractor/process` → `{jobId}` with HTTP 202, after kicking off an async Lambda invoke. `GET /api/bgm-extractor/status?jobId=...` → `{status: "processing"}` | `{status: "done", vocalsUrl, instrumentalUrl}` | `{status: "error", error}`. Task 7's `page.tsx` calls all three by these exact paths/shapes.

There's no existing convention in this codebase for testing Next.js route handlers in isolation (confirmed: `app/app/api/looper/process/route.ts` and `upload-url/route.ts` have no dedicated tests, only indirect coverage via page-level `fetch` mocks) — this task is verified by a TypeScript compile check instead, and by Task 7's page-level test exercising all three routes' contracts through mocked `fetch`.

- [ ] **Step 1: Write the upload-url route**

`app/app/api/bgm-extractor/upload-url/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { keyForUpload, presignUpload } from "@/lib/aws";

export async function POST(request: NextRequest) {
  const { filename, contentType } = await request.json();
  const key = keyForUpload(filename);
  const uploadUrl = await presignUpload(key, contentType);
  return NextResponse.json({ key, uploadUrl });
}
```

- [ ] **Step 2: Write the process route**

`app/app/api/bgm-extractor/process/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { deriveOutputPrefix } from "@/lib/aws";

export async function POST(request: NextRequest) {
  const { key } = await request.json();
  const outputPrefix = deriveOutputPrefix(key);
  const jobId = outputPrefix.replace(/^outputs\//, "");

  const client = new LambdaClient({ region: process.env.APP_AWS_REGION! });
  const command = new InvokeCommand({
    FunctionName: process.env.DEMUCS_LAMBDA_FUNCTION_NAME!,
    InvocationType: "Event",
    Payload: Buffer.from(
      JSON.stringify({
        bucket: process.env.S3_BUCKET_NAME,
        input_key: key,
        output_prefix: outputPrefix,
      }),
    ),
  });

  await client.send(command);
  return NextResponse.json({ jobId }, { status: 202 });
}
```

- [ ] **Step 3: Write the status route**

`app/app/api/bgm-extractor/status/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { objectExists, presignDownload } from "@/lib/aws";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "missing jobId" }, { status: 400 });
  }

  const prefix = `outputs/${jobId}`;
  const vocalsKey = `${prefix}/vocals.wav`;
  const instrumentalKey = `${prefix}/instrumental.wav`;
  const errorKey = `${prefix}/error.json`;

  if (await objectExists(errorKey)) {
    return NextResponse.json({ status: "error", error: "Processing failed" });
  }

  const [vocalsExists, instrumentalExists] = await Promise.all([
    objectExists(vocalsKey),
    objectExists(instrumentalKey),
  ]);

  if (vocalsExists && instrumentalExists) {
    const [vocalsUrl, instrumentalUrl] = await Promise.all([
      presignDownload(vocalsKey),
      presignDownload(instrumentalKey),
    ]);
    return NextResponse.json({ status: "done", vocalsUrl, instrumentalUrl });
  }

  return NextResponse.json({ status: "processing" });
}
```

- [ ] **Step 4: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/app/api/bgm-extractor
git commit -m "feat(app): add bgm-extractor upload-url, process, and status API routes"
```

---

### Task 6: Gate the new routes behind the shared password

**Files:**
- Modify: `app/lib/route-gate.ts`, `app/lib/route-gate.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `isGatedPath("/tools/bgm-extractor")` and `isGatedPath("/api/bgm-extractor/...")` now return `true`. `app/proxy.ts` (unmodified — it already calls `isGatedPath` generically) picks this up automatically.

- [ ] **Step 1: Write the failing tests**

Add to `app/lib/route-gate.test.ts`'s existing `it.each` table (inside the array, alongside the existing entries):
```typescript
    ["/tools/bgm-extractor", true],
    ["/tools/bgm-extractor/", true],
    ["/api/bgm-extractor/upload-url", true],
    ["/api/bgm-extractor/process", true],
    ["/api/bgm-extractor/status", true],
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- route-gate.test.ts`
Expected: FAIL — the 5 new cases return `false` (not in `GATED_PREFIXES` yet)

- [ ] **Step 3: Update `GATED_PREFIXES`**

In `app/lib/route-gate.ts`, change:
```typescript
const GATED_PREFIXES = ["/tools/bgm-looper", "/api/looper", "/keystatic", "/api/keystatic"];
```
to:
```typescript
const GATED_PREFIXES = [
  "/tools/bgm-looper",
  "/api/looper",
  "/tools/bgm-extractor",
  "/api/bgm-extractor",
  "/keystatic",
  "/api/keystatic",
];
```

`ALWAYS_ALLOWED_PATHS` stays unchanged — BGM Extractor has no dedicated login page; unauthenticated visits redirect to the existing `/tools/bgm-looper/login?next=/tools/bgm-extractor`, which already round-trips back to any `next` path (`app/app/tools/bgm-looper/login/page.tsx`'s `safeNext` preserves it) — see the design spec §7.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- route-gate.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add app/lib/route-gate.ts app/lib/route-gate.test.ts
git commit -m "feat(app): gate /tools/bgm-extractor behind the shared password"
```

---

### Task 7: BGM Extractor page (upload, poll, show both stems)

**Files:**
- Create: `app/app/tools/bgm-extractor/page.tsx`
- Test: `app/app/tools/bgm-extractor/page.test.tsx`

**Interfaces:**
- Consumes: `/api/bgm-extractor/upload-url`, `/api/bgm-extractor/process`, `/api/bgm-extractor/status` (Task 5).
- Produces: the tool's UI at `/tools/bgm-extractor`. No other task depends on this one.

- [ ] **Step 1: Write the failing tests**

`app/app/tools/bgm-extractor/page.test.tsx`:
```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Home from "./page";

function mockFetchSequence() {
  return vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ key: "uploads/abc.mp3", uploadUrl: "https://s3/upload" }),
    })
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jobId: "abc" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "processing" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "done",
        vocalsUrl: "https://s3/vocals",
        instrumentalUrl: "https://s3/instrumental",
      }),
    });
}

describe("Home", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchSequence());
  });

  it(
    "uploads, polls, and shows both stems when done",
    async () => {
      render(<Home />);
      const file = new File(["bytes"], "song.mp3", { type: "audio/mpeg" });
      const input = screen.getByLabelText(/choose/i, { selector: "input" }) as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(
        () => {
          expect(screen.getAllByRole("link", { name: /download/i })).toHaveLength(2);
        },
        { timeout: 10000 },
      );
      expect(screen.getByText(/vocals/i)).toBeInTheDocument();
      expect(screen.getByText(/background music/i)).toBeInTheDocument();
    },
    15000,
  );

  it("shows an error message when the job fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ key: "uploads/abc.mp3", uploadUrl: "https://s3/upload" }),
        })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ jobId: "abc" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "error", error: "boom" }),
        }),
    );

    render(<Home />);
    const file = new File(["bytes"], "song.mp3", { type: "audio/mpeg" });
    const input = screen.getByLabelText(/choose/i, { selector: "input" }) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
```

This uses real timers deliberately (not `vi.useFakeTimers()`), since testing-library's `waitFor` polling interacts unreliably with fake timers. The first test's `POLL_INTERVAL_MS` (3000ms, set below) means the "done" status only arrives after one real 3-second wait — the `waitFor` timeout (10000ms) and the test's own timeout (15000ms) both need to comfortably exceed that.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npm test -- bgm-extractor/page.test.tsx`
Expected: FAIL — `app/app/tools/bgm-extractor/page.tsx` doesn't exist yet

- [ ] **Step 3: Write minimal implementation**

`app/app/tools/bgm-extractor/page.tsx`:
```tsx
"use client";
import { useState } from "react";

type Status = "idle" | "uploading" | "processing" | "done" | "error";

const POLL_INTERVAL_MS = 3000;

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [vocalsUrl, setVocalsUrl] = useState<string | null>(null);
  const [instrumentalUrl, setInstrumentalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pollStatus(jobId: string) {
    const res = await fetch(`/api/bgm-extractor/status?jobId=${jobId}`);
    const data = await res.json();

    if (data.status === "done") {
      setVocalsUrl(data.vocalsUrl);
      setInstrumentalUrl(data.instrumentalUrl);
      setStatus("done");
      return;
    }
    if (data.status === "error") {
      setError(data.error);
      setStatus("error");
      return;
    }
    setTimeout(() => pollStatus(jobId), POLL_INTERVAL_MS);
  }

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    setVocalsUrl(null);
    setInstrumentalUrl(null);

    try {
      const urlRes = await fetch("/api/bgm-extractor/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      const { key, uploadUrl } = await urlRes.json();

      await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      setStatus("processing");
      const processRes = await fetch("/api/bgm-extractor/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!processRes.ok) throw new Error("Processing failed to start");
      const { jobId } = await processRes.json();

      pollStatus(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  return (
    <main>
      <label>
        Choose an audio file
        <input
          type="file"
          accept="audio/*"
          disabled={status === "uploading" || status === "processing"}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="file:mr-3 file:border-0 file:bg-accent file:px-3 file:py-1.5 file:font-mono file:text-bg"
        />
      </label>

      {status === "uploading" && <p>Uploading…</p>}
      {status === "processing" && (
        <p>Separating vocals and background music — this can take a few minutes…</p>
      )}
      {status === "error" && <p role="alert">{error}</p>}
      {status === "done" && vocalsUrl && instrumentalUrl && (
        <div>
          <div>
            <p>Vocals</p>
            <audio controls src={vocalsUrl} />
            <a href={vocalsUrl} download className="text-accent underline">
              Download
            </a>
          </div>
          <div>
            <p>Background Music</p>
            <audio controls src={instrumentalUrl} />
            <a href={instrumentalUrl} download className="text-accent underline">
              Download
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npm test -- bgm-extractor/page.test.tsx`
Expected: PASS (2 tests; the first takes ~3+ real seconds)

- [ ] **Step 5: Commit**

```bash
git add app/app/tools/bgm-extractor/page.tsx app/app/tools/bgm-extractor/page.test.tsx
git commit -m "feat(app): add bgm-extractor page with upload + status polling"
```

---

### Task 8: Terraform — Demucs ECR repo + extend shared IAM policies

**Files:**
- Modify: `infra/main/shared.tf`

**Interfaces:**
- Consumes: `var.project_name` (existing), `aws_iam_role.lambda_exec` (existing — reused as-is, no changes needed to the role or its S3 policy since it's already scoped to `local.all_audio_bucket_arns`, which already covers the bucket this new Lambda will read/write).
- Produces: `aws_ecr_repository.demucs` (Task 9's CI workflow pushes into it; Task 10's Lambda function reads its URL). `local.demucs_lambda_function_name` / `local.demucs_lambda_function_arn` — Task 10 uses these. The `vercel`/`ci_deploy` IAM users' policies now also cover the new function/repo.

- [ ] **Step 1: Extend the `locals` block**

In `infra/main/shared.tf`, change:
```hcl
locals {
  lambda_function_name = "${var.project_name}-processor"
  lambda_function_arn  = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.lambda_function_name}"

  all_lambda_function_arns = concat(
    [local.lambda_function_arn],
    [for f in aws_lambda_function.looper_env : f.arn]
  )
  all_audio_bucket_arns = concat(
    [aws_s3_bucket.audio.arn],
    [for b in aws_s3_bucket.audio_env : b.arn]
  )
}
```
to:
```hcl
locals {
  lambda_function_name = "${var.project_name}-processor"
  lambda_function_arn  = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.lambda_function_name}"

  demucs_lambda_function_name = "${var.project_name}-demucs-processor"
  demucs_lambda_function_arn  = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.demucs_lambda_function_name}"

  all_lambda_function_arns = concat(
    [local.lambda_function_arn],
    [for f in aws_lambda_function.looper_env : f.arn],
    [local.demucs_lambda_function_arn],
    [for f in aws_lambda_function.demucs_env : f.arn]
  )
  all_audio_bucket_arns = concat(
    [aws_s3_bucket.audio.arn],
    [for b in aws_s3_bucket.audio_env : b.arn]
  )
}
```
`all_lambda_function_arns` now covers both tools' functions in one place — both IAM user policies below reference this local already, so extending it here is the only change they need.

- [ ] **Step 2: Add the ECR repo + lifecycle policy**

Add to `infra/main/shared.tf` (after the existing `aws_ecr_lifecycle_policy.looper` resource):
```hcl
resource "aws_ecr_repository" "demucs" {
  name         = "${var.project_name}-demucs-lambda"
  force_delete = true
}

resource "aws_ecr_lifecycle_policy" "demucs" {
  repository = aws_ecr_repository.demucs.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the 1 most recent main image"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["main"]
          countType     = "imageCountMoreThan"
          countNumber   = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 3
        description  = "Keep only the 1 most recent dev image"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["dev"]
          countType     = "imageCountMoreThan"
          countNumber   = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 4
        description  = "Keep only the 1 most recent stage image"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["stage"]
          countType     = "imageCountMoreThan"
          countNumber   = 1
        }
        action = { type = "expire" }
      }
    ]
  })
}
```
Retention is 1 per branch (not BGM Looper's 5) because this image is estimated at 3–5GB vs. ~200MB — see the design spec §9 for the ECR storage cost math this is based on. Trade-off: no rollback via ECR on a bad deploy — a fresh CI rebuild from git history is the recovery path, acceptable for a personal, low-frequency-deploy tool.

- [ ] **Step 3: Extend the CI-deploy IAM user's ECR policy statement**

In `infra/main/shared.tf`'s `aws_iam_user_policy.ci_deploy` resource, change:
```hcl
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:BatchGetImage",
        ]
        Resource = aws_ecr_repository.looper.arn
      },
```
to:
```hcl
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:BatchGetImage",
        ]
        Resource = [aws_ecr_repository.looper.arn, aws_ecr_repository.demucs.arn]
      },
```
The `lambda:UpdateFunctionCode`/`GetFunction` statement below it (and the `vercel` user's `lambda:InvokeFunction` statement) already reference `local.all_lambda_function_arns` — no further edits needed there, since Step 1 already extended that local.

- [ ] **Step 4: Validate, plan, and apply just the new ECR repo**

Run: `cd infra/main && terraform validate`
Expected: succeeds.

Run: `terraform plan -var-file=terraform.tfvars`
Expected: plan shows the new ECR repo + lifecycle policy to add, plus in-place updates to `aws_iam_user_policy.ci_deploy` (and no changes yet to `aws_iam_user_policy.vercel`'s actual rendered policy, since `aws_lambda_function.demucs`/`demucs_env` don't exist yet — `local.demucs_lambda_function_arn` is a deterministic ARN string, not a live resource attribute, so this plan doesn't depend on Task 10). 0 destroys.

Run: `terraform apply -target=aws_ecr_repository.demucs -target=aws_ecr_lifecycle_policy.demucs -target=aws_iam_user_policy.ci_deploy -target=aws_iam_user_policy.vercel -var-file=terraform.tfvars`
Expected: those 4 resources created/updated. (Scoped with `-target` deliberately — `aws_lambda_function.demucs`/`demucs_env`, added in Task 10, aren't ready to apply yet since their `image_uri` needs a real image in ECR first, which Task 9's CI push provides.)

- [ ] **Step 5: Commit**

```bash
git add infra/main/shared.tf
git commit -m "feat(infra): add Demucs ECR repo and extend shared IAM policies"
```

---

### Task 9: CI/CD — build and deploy the Demucs Lambda image

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `lambda-demucs/` (Tasks 1–3), `aws_ecr_repository.demucs` (Task 8, already applied), the existing `AWS_CI_ACCESS_KEY_ID`/`AWS_CI_SECRET_ACCESS_KEY` repo secrets (already scoped to cover this new repo/function set as of Task 8).
- Produces: on every push to `main`/`dev`/`stage` that touches `lambda-demucs/` (or this workflow file), builds and pushes a Demucs image to `bgm-looper-demucs-lambda`, tagged `demucs`-prefixed... actually tag-prefixed the same way as the existing job (`main-`/`dev-`/`stage-` + SHA), and calls `update-function-code` on that branch's Demucs Lambda function (no-ops gracefully before Task 10's `terraform apply` has created it).

- [ ] **Step 1: Add the `DEMUCS_ECR_REPOSITORY` env var**

In `.github/workflows/deploy.yml`, change the top-level `env:` block from:
```yaml
env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: bgm-looper-lambda
```
to:
```yaml
env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: bgm-looper-lambda
  DEMUCS_ECR_REPOSITORY: bgm-looper-demucs-lambda
```

- [ ] **Step 2: Add a `demucs` output to the `changes` job**

Change:
```yaml
  changes:
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    outputs:
      lambda: ${{ steps.check.outputs.lambda }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Check for lambda changes
        id: check
        run: |
          if [ "${{ github.event.before }}" = "0000000000000000000000000000000000000000" ]; then
            echo "lambda=true" >> "$GITHUB_OUTPUT"
            echo "No previous commit to diff against (new branch or rewritten history) — building to be safe."
            exit 0
          fi
          if git diff --quiet "${{ github.event.before }}" "${{ github.sha }}" -- lambda/ .github/workflows/deploy.yml; then
            echo "lambda=false" >> "$GITHUB_OUTPUT"
            echo "No changes under lambda/ or deploy.yml — skipping the Lambda image build."
          else
            echo "lambda=true" >> "$GITHUB_OUTPUT"
          fi
```
to:
```yaml
  changes:
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    outputs:
      lambda: ${{ steps.check.outputs.lambda }}
      demucs: ${{ steps.check.outputs.demucs }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Check for lambda changes
        id: check
        run: |
          if [ "${{ github.event.before }}" = "0000000000000000000000000000000000000000" ]; then
            echo "lambda=true" >> "$GITHUB_OUTPUT"
            echo "demucs=true" >> "$GITHUB_OUTPUT"
            echo "No previous commit to diff against (new branch or rewritten history) — building both to be safe."
            exit 0
          fi
          if git diff --quiet "${{ github.event.before }}" "${{ github.sha }}" -- lambda/ .github/workflows/deploy.yml; then
            echo "lambda=false" >> "$GITHUB_OUTPUT"
            echo "No changes under lambda/ or deploy.yml — skipping the Lambda image build."
          else
            echo "lambda=true" >> "$GITHUB_OUTPUT"
          fi
          if git diff --quiet "${{ github.event.before }}" "${{ github.sha }}" -- lambda-demucs/ .github/workflows/deploy.yml; then
            echo "demucs=false" >> "$GITHUB_OUTPUT"
            echo "No changes under lambda-demucs/ or deploy.yml — skipping the Demucs image build."
          else
            echo "demucs=true" >> "$GITHUB_OUTPUT"
          fi
```

- [ ] **Step 3: Add Demucs Lambda test steps to the `test` job**

In the `test` job, add these two steps right after the existing "Run Lambda tests" step and before "Set up Node":
```yaml
      - name: Install Demucs Lambda test dependencies
        working-directory: lambda-demucs
        run: pip install boto3 pytest moto

      - name: Run Demucs Lambda tests
        working-directory: lambda-demucs
        run: pytest -v
```
Deliberately `pip install boto3 pytest moto`, not `pip install -r requirements.txt` — see the Global Constraints note on why the heavy ML deps aren't needed to run these tests.

- [ ] **Step 4: Add the `deploy_demucs` job**

Add a new job, after the existing `deploy` job and before `release`:
```yaml
  deploy_demucs:
    needs: [test, changes]
    runs-on: ubuntu-latest
    if: always() && needs.test.result == 'success' && (github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && needs.changes.result == 'success' && needs.changes.outputs.demucs == 'true'))
    steps:
      - uses: actions/checkout@v7

      - name: Set environment for this branch
        id: env
        run: |
          case "${{ github.ref_name }}" in
            main)  echo "function_name=bgm-looper-demucs-processor"       >> "$GITHUB_OUTPUT"; echo "tag_prefix=main"  >> "$GITHUB_OUTPUT" ;;
            dev)   echo "function_name=bgm-looper-demucs-processor-dev"   >> "$GITHUB_OUTPUT"; echo "tag_prefix=dev"   >> "$GITHUB_OUTPUT" ;;
            stage) echo "function_name=bgm-looper-demucs-processor-stage" >> "$GITHUB_OUTPUT"; echo "tag_prefix=stage" >> "$GITHUB_OUTPUT" ;;
          esac

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v6
        with:
          aws-access-key-id: ${{ secrets.AWS_CI_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_CI_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Log in to ECR
        id: ecr-login
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push image
        working-directory: lambda-demucs
        env:
          REGISTRY: ${{ steps.ecr-login.outputs.registry }}
          TAG_PREFIX: ${{ steps.env.outputs.tag_prefix }}
        run: |
          docker build -t "$REGISTRY/$DEMUCS_ECR_REPOSITORY:${TAG_PREFIX}-${{ github.sha }}" .
          docker push "$REGISTRY/$DEMUCS_ECR_REPOSITORY:${TAG_PREFIX}-${{ github.sha }}"
          if [ "$TAG_PREFIX" = "main" ]; then
            docker tag "$REGISTRY/$DEMUCS_ECR_REPOSITORY:${TAG_PREFIX}-${{ github.sha }}" "$REGISTRY/$DEMUCS_ECR_REPOSITORY:latest"
            docker push "$REGISTRY/$DEMUCS_ECR_REPOSITORY:latest"
          fi

      - name: Update Lambda function code
        env:
          REGISTRY: ${{ steps.ecr-login.outputs.registry }}
          FUNCTION_NAME: ${{ steps.env.outputs.function_name }}
          TAG_PREFIX: ${{ steps.env.outputs.tag_prefix }}
        run: |
          if aws lambda get-function --function-name "$FUNCTION_NAME" >/dev/null 2>&1; then
            aws lambda update-function-code \
              --function-name "$FUNCTION_NAME" \
              --image-uri "$REGISTRY/$DEMUCS_ECR_REPOSITORY:${TAG_PREFIX}-${{ github.sha }}"
          else
            echo "Lambda function $FUNCTION_NAME does not exist yet — skipping update-function-code (expected before its terraform apply has run)."
          fi
```
Job id is `deploy_demucs` (underscore, not a hyphen like `deploy-demucs`) so `needs.deploy_demucs.result` in Step 5 below is unambiguous dot-notation.

- [ ] **Step 5: Make `release` wait on `deploy_demucs` too**

In the `release` job, change:
```yaml
  release:
    needs: [test, deploy]
```
to:
```yaml
  release:
    needs: [test, deploy, deploy_demucs]
```
and change its `if:` from:
```yaml
    if: always() && github.ref == 'refs/heads/main' && needs.test.result == 'success' && needs.deploy.result != 'failure' && needs.deploy.result != 'cancelled'
```
to:
```yaml
    if: always() && github.ref == 'refs/heads/main' && needs.test.result == 'success' && needs.deploy.result != 'failure' && needs.deploy.result != 'cancelled' && needs.deploy_demucs.result != 'failure' && needs.deploy_demucs.result != 'cancelled'
```

- [ ] **Step 6: Commit and push**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat(ci): build and deploy the Demucs Lambda image"
git push origin HEAD
```

- [ ] **Step 7: Verify the CI run and the image landing in ECR**

Run: `gh run list --workflow=deploy.yml --limit 1` then `gh run watch <run-id>`
Expected: `test` job passes (including the new Demucs Lambda tests); `deploy_demucs` job's build/push steps succeed; its "Update Lambda function code" step logs "does not exist yet" and exits 0 (expected — Task 10 hasn't run yet).

Run: `aws --profile personal ecr describe-images --repository-name bgm-looper-demucs-lambda`
Expected: shows an image tagged with this branch's prefix + SHA (and `latest`, if this push was to `main`).

---

### Task 10: Terraform — Demucs Lambda function + Vercel env vars

**Files:**
- Modify: `infra/main/environments.tf`

**Interfaces:**
- Consumes: `aws_ecr_repository.demucs` (Task 8, must already have an image per branch — confirmed in Task 9 Step 7), `aws_iam_role.lambda_exec` (existing, unmodified), `local.demucs_lambda_function_name` (Task 8).
- Produces: `aws_lambda_function.demucs` + `.demucs_env["dev"|"stage"]`, and the `DEMUCS_LAMBDA_FUNCTION_NAME` Vercel env var per branch — Task 5's `/api/bgm-extractor/process` route reads this exact env var name.

- [ ] **Step 1: Add the Lambda function resources**

Add to `infra/main/environments.tf` (after the existing `aws_lambda_function.looper_env` resource):
```hcl
resource "aws_lambda_function" "demucs" {
  function_name = local.demucs_lambda_function_name
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.demucs.repository_url}:latest"
  timeout       = 600
  memory_size   = 3008

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.lambda_s3]

  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_function_event_invoke_config" "demucs" {
  function_name          = aws_lambda_function.demucs.function_name
  maximum_retry_attempts = 0
}

resource "aws_lambda_function" "demucs_env" {
  for_each      = toset(["dev", "stage"])
  function_name = "${local.demucs_lambda_function_name}-${each.key}"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.demucs.repository_url}:latest"
  timeout       = 600
  memory_size   = 3008

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.lambda_s3]

  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_function_event_invoke_config" "demucs_env" {
  for_each                = aws_lambda_function.demucs_env
  function_name            = each.value.function_name
  maximum_retry_attempts   = 0
}
```
`role = aws_iam_role.lambda_exec.arn` — the same execution role BGM Looper's functions use, already scoped (via `aws_iam_role_policy.lambda_s3`) to `local.all_audio_bucket_arns`, which already includes this bucket. No new IAM role or policy needed for the functions themselves.

- [ ] **Step 2: Add the `DEMUCS_LAMBDA_FUNCTION_NAME` Vercel env vars**

Add to `infra/main/environments.tf` (after the existing `lambda_function_name_stage` resource):
```hcl
resource "vercel_project_environment_variable" "demucs_lambda_function_name_production" {
  project_id = vercel_project.looper.id
  key        = "DEMUCS_LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.demucs.function_name
  target     = ["production"]
}

resource "vercel_project_environment_variable" "demucs_lambda_function_name_preview" {
  project_id = vercel_project.looper.id
  key        = "DEMUCS_LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.demucs_env["dev"].function_name
  target     = ["preview"]
}

resource "vercel_project_environment_variable" "demucs_lambda_function_name_stage" {
  project_id = vercel_project.looper.id
  key        = "DEMUCS_LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.demucs_env["stage"].function_name
  target     = ["preview"]
  git_branch = "stage"
}
```
Same `production`/bare-`preview`/`stage`-branch-override pattern as the existing `LAMBDA_FUNCTION_NAME` vars.

- [ ] **Step 3: Validate, plan, and apply**

Confirm Task 9 Step 7 already showed images in `bgm-looper-demucs-lambda` for at least the branch you're applying against.

Run: `cd infra/main && terraform validate`
Expected: succeeds.

Run: `terraform plan -var-file=terraform.tfvars`
Expected: plan adds 8 resources (2 Lambda functions + 1 `for_each` twin resource covering 2 more + 2 event-invoke-configs + 1 `for_each` twin covering 2 more + 3 Vercel env vars — exact count depends on how Terraform reports `for_each` resources, but net-new should be: `aws_lambda_function.demucs`, `aws_lambda_function.demucs_env["dev"]`, `aws_lambda_function.demucs_env["stage"]`, `aws_lambda_function_event_invoke_config.demucs`, `aws_lambda_function_event_invoke_config.demucs_env["dev"]`, `aws_lambda_function_event_invoke_config.demucs_env["stage"]`, and 3 `vercel_project_environment_variable` resources). 0 destroys.

Run: `terraform apply -var-file=terraform.tfvars`
Expected: resources created.

- [ ] **Step 4: Verify with a real invoke**

Manually upload a small test audio file (ideally a short clip with both voice and music) to `s3://<audio_bucket_name>/uploads/test.wav`, then:

Run:
```bash
aws --profile personal lambda invoke --function-name bgm-looper-demucs-processor-dev \
  --payload '{"bucket":"<audio_bucket_name>","input_key":"uploads/test.wav","output_prefix":"outputs/test"}' \
  --cli-binary-format raw-in-base64-out --invocation-type Event out.json
cat out.json
```
Expected: empty response body (202-equivalent for `Event` invocation — the function runs asynchronously). Wait a few minutes, then check:
```bash
aws --profile personal s3 ls s3://<audio_bucket_name>/outputs/test/
```
Expected: `vocals.wav` and `instrumental.wav` both present (or `error.json` if something went wrong — check its contents and CloudWatch logs for `bgm-looper-demucs-processor-dev` if so).

- [ ] **Step 5: Commit**

```bash
git add infra/main/environments.tf
git commit -m "feat(infra): add Demucs Lambda function and Vercel env var"
```

---

### Task 11: End-to-end verification through the deployed UI

**Files:** none (manual verification only, per the design spec §11's "Manual end-to-end" testing note).

**Interfaces:** none — this task exercises everything built in Tasks 1–10 together.

- [ ] **Step 1: Log in and open the tool**

Visit the dev-branch deployment's `/tools/bgm-extractor` (redirects to the shared login if not already authenticated — log in with the shared password).

- [ ] **Step 2: Upload a real voice + background-music recording**

Pick or record a short (under a minute) clip with a clearly audible voice over background music. Upload it through the file picker.

- [ ] **Step 3: Confirm the UI progresses through all states correctly**

Expected: `Uploading…` → `Separating vocals and background music — this can take a few minutes…` (polling, no error) → both stem players + download links appear once Demucs finishes.

- [ ] **Step 4: Listen to both stems**

Download both files and listen: the "Vocals" file should contain (mostly) the voice with the music suppressed; the "Background Music" file should contain the music with the voice suppressed. Some bleed/artifacts are expected — Demucs isn't perfect — but the separation should be clearly audible, not silent or unchanged from the original.

- [ ] **Step 5: Confirm objects expire**

No action needed here beyond noting it: both stems live under `outputs/` in the same bucket as BGM Looper's outputs, which already has the existing 1-day lifecycle rule applied — no separate cleanup step required.
