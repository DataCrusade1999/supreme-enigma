# BGM Looper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user web app (Next.js on Vercel + AWS Lambda/S3) that takes an uploaded BGM audio file and returns an edited version that loops seamlessly, with the entire stack provisioned by Terraform so one `terraform destroy` tears everything down.

**Architecture:** Browser uploads/downloads audio directly to/from S3 via presigned URLs; Vercel API routes only orchestrate (get URL, invoke Lambda, get result URL) and never touch audio bytes. The DSP pipeline (loudness normalize → silence trim → beat-aligned loop-point search → crossfade → ffmpeg transcode) runs as a containerized Python Lambda. Two Terraform layers: `infra/bootstrap` (state bucket, applied once, never destroyed) and `infra/main` (S3, ECR, Lambda, IAM, Vercel project — this is the kill switch).

**Tech Stack:** Next.js (App Router, TypeScript) on Vercel; Python 3.12 + librosa/numpy/soundfile/pyloudnorm in a Lambda container image; Terraform ≥1.10 with `aws` + `vercel` + `random` providers, S3 backend with native locking.

## Global Constraints

- Loudness target: -14 LUFS integrated, true-peak ceiling -1 dBTP.
- Silence trim threshold: `top_db=40.0`.
- Loop search: minimum loop length 2.0s, seam-comparison window 0.05s (50ms).
- Crossfade length: 0.05s (50ms), equal-power curve.
- Output container/codec must match the input file's original format (ffmpeg transcode from an intermediate WAV).
- Lambda: 1024MB memory, 60s timeout, container image (`package_type = "Image"`).
- S3 lifecycle: objects in `uploads/` and `outputs/` expire after 1 day.
- Lambda invocation from Vercel: classic synchronous `Invoke` API (`lambda:InvokeFunction`), not Function URLs — Vercel already holds AWS SDK creds server-side, so a Function URL adds nothing.
- Terraform ≥1.10.0, S3 backend with `use_lockfile = true` (no DynamoDB lock table).
- Two Terraform layers: `infra/bootstrap` (local state, applied once, holds only the state bucket, never destroyed) and `infra/main` (remote state, everything else — `terraform destroy` here is the kill switch).
- Every sensitive Terraform variable/output/resource attribute marked `sensitive = true`.
- IAM: the Vercel service-account IAM user is scoped to `s3:GetObject`/`s3:PutObject` on the audio bucket's objects only, and `lambda:InvokeFunction` on this one Lambda only. No root/account credentials anywhere in Terraform or Vercel env vars.
- Auth: single shared password (env var), constant-time compare, HttpOnly signed cookie. No user table, no OAuth.
- No job queue, no database, no async status polling — synchronous request/response throughout (files are <5 min / <20MB, Lambda runtime ~10–20s).

---

### Task 1: Repo scaffold

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/next.config.mjs`, `app/vitest.config.ts`, `app/.gitignore`
- Create: `lambda/requirements.txt`, `lambda/src/looper/__init__.py`
- Create: `infra/bootstrap/.gitkeep`, `infra/main/.gitkeep`
- Create: `.gitignore` (repo root)

**Interfaces:**
- Produces: `app/` (Next.js workspace), `lambda/` (Python DSP package `looper`), `infra/` (Terraform layers) — the three top-level directories every later task writes into.

- [ ] **Step 1: Create root `.gitignore`**

```gitignore
node_modules/
.next/
__pycache__/
*.pyc
.venv/
*.tfstate
*.tfstate.*
.terraform/
.terraform.lock.hcl
*.tfvars
```

- [ ] **Step 2: Scaffold the Next.js app**

`app/package.json`:
```json
{
  "name": "bgm-looper-app",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@aws-sdk/client-s3": "^3.600.0",
    "@aws-sdk/client-lambda": "^3.600.0",
    "@aws-sdk/s3-request-presigner": "^3.600.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "jsdom": "^25.0.0",
    "@vitejs/plugin-react": "^4.3.0"
  }
}
```

`app/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

`app/next.config.mjs`:
```javascript
/** @type {import('next').NextConfig} */
export default {};
```

`app/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

`app/.gitignore`:
```gitignore
node_modules/
.next/
.env*.local
```

- [ ] **Step 3: Scaffold the Lambda Python package**

`lambda/requirements.txt`:
```
librosa>=0.10,<0.11
numpy>=1.26,<2.0
soundfile>=0.12,<0.13
pyloudnorm>=0.1.1,<0.2
```

`lambda/src/looper/__init__.py`: empty file.

- [ ] **Step 4: Create empty Terraform layer directories**

`infra/bootstrap/.gitkeep` and `infra/main/.gitkeep`: empty files (placeholders so git tracks the directories; removed once real `.tf` files land in Tasks 9–12).

- [ ] **Step 5: Install app dependencies**

Run: `cd app && npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Commit**

```bash
git add app lambda infra .gitignore
git commit -m "chore: scaffold app, lambda, and infra directories"
```

---

### Task 2: Loudness normalization

**Files:**
- Create: `lambda/src/looper/loudness.py`
- Test: `lambda/tests/test_loudness.py`

**Interfaces:**
- Produces: `normalize_loudness(y: np.ndarray, sr: int, target_lufs: float = -14.0, true_peak_ceiling_db: float = -1.0) -> np.ndarray` — accepts shape `(n_samples,)` or `(n_samples, n_channels)`, returns same shape.

- [ ] **Step 1: Write the failing test**

`lambda/tests/test_loudness.py`:
```python
import numpy as np
import pyloudnorm as pyln
from looper.loudness import normalize_loudness


def test_normalize_reaches_target_lufs():
    sr = 44100
    t = np.linspace(0, 3, sr * 3, endpoint=False)
    y = (0.05 * np.sin(2 * np.pi * 440 * t)).astype(np.float64)

    out = normalize_loudness(y, sr, target_lufs=-14.0)

    meter = pyln.Meter(sr)
    measured = meter.integrated_loudness(out)
    assert abs(measured - (-14.0)) < 0.5


def test_normalize_never_clips_above_ceiling():
    sr = 44100
    t = np.linspace(0, 3, sr * 3, endpoint=False)
    y = (0.9 * np.sin(2 * np.pi * 440 * t)).astype(np.float64)

    out = normalize_loudness(y, sr, target_lufs=-6.0, true_peak_ceiling_db=-1.0)

    ceiling = 10 ** (-1.0 / 20)
    assert np.max(np.abs(out)) <= ceiling + 1e-6


def test_normalize_preserves_stereo_shape():
    sr = 44100
    t = np.linspace(0, 2, sr * 2, endpoint=False)
    mono = 0.05 * np.sin(2 * np.pi * 440 * t)
    y = np.stack([mono, mono], axis=1)

    out = normalize_loudness(y, sr)

    assert out.shape == y.shape
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lambda && pip install -r requirements.txt pytest && pytest tests/test_loudness.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'looper.loudness'`

- [ ] **Step 3: Write minimal implementation**

`lambda/src/looper/loudness.py`:
```python
import numpy as np
import pyloudnorm as pyln


def normalize_loudness(
    y: np.ndarray,
    sr: int,
    target_lufs: float = -14.0,
    true_peak_ceiling_db: float = -1.0,
) -> np.ndarray:
    meter = pyln.Meter(sr)
    loudness = meter.integrated_loudness(y)
    gain_db = target_lufs - loudness
    gain = 10 ** (gain_db / 20)
    y_norm = y * gain

    peak = np.max(np.abs(y_norm))
    ceiling = 10 ** (true_peak_ceiling_db / 20)
    if peak > ceiling:
        y_norm = y_norm * (ceiling / peak)

    return y_norm
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd lambda && pytest tests/test_loudness.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lambda/src/looper/loudness.py lambda/tests/test_loudness.py lambda/requirements.txt
git commit -m "feat(lambda): add loudness normalization"
```

---

### Task 3: Silence trim

**Files:**
- Create: `lambda/src/looper/trim.py`
- Test: `lambda/tests/test_trim.py`

**Interfaces:**
- Produces: `trim_silence(mono: np.ndarray, top_db: float = 40.0) -> tuple[int, int]` — returns `(start_sample, end_sample)` indices into `mono`.

- [ ] **Step 1: Write the failing test**

`lambda/tests/test_trim.py`:
```python
import numpy as np
from looper.trim import trim_silence


def test_trim_removes_leading_and_trailing_silence():
    sr = 44100
    silence = np.zeros(sr, dtype=np.float64)
    t = np.linspace(0, 2, sr * 2, endpoint=False)
    tone = 0.5 * np.sin(2 * np.pi * 440 * t)
    mono = np.concatenate([silence, tone, silence])

    start, end = trim_silence(mono, top_db=40.0)

    assert start > sr * 0.5
    assert end < len(mono) - sr * 0.5
    assert end > start
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lambda && pytest tests/test_trim.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'looper.trim'`

- [ ] **Step 3: Write minimal implementation**

`lambda/src/looper/trim.py`:
```python
import librosa
import numpy as np


def trim_silence(mono: np.ndarray, top_db: float = 40.0) -> tuple[int, int]:
    _, index = librosa.effects.trim(mono, top_db=top_db)
    return int(index[0]), int(index[1])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd lambda && pytest tests/test_trim.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lambda/src/looper/trim.py lambda/tests/test_trim.py
git commit -m "feat(lambda): add silence trim"
```

---

### Task 4: Loop-point finder

**Files:**
- Create: `lambda/src/looper/loop_point.py`
- Test: `lambda/tests/test_loop_point.py`

**Interfaces:**
- Produces: `find_loop_point(mono: np.ndarray, sr: int, min_loop_sec: float = 2.0, window_sec: float = 0.05) -> tuple[int, int] | None` — returns `(start_sample, end_sample)` of the best-scoring beat-aligned loop region, or `None` if fewer than 2 beats are detected.

- [ ] **Step 1: Write the failing test**

`lambda/tests/test_loop_point.py`:
```python
import numpy as np
from looper.loop_point import find_loop_point


def test_finds_loop_point_in_repeating_beat_pattern():
    sr = 22050
    bpm = 120
    beat_sec = 60 / bpm
    n_beats = 16
    duration = beat_sec * n_beats
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)

    mono = np.zeros_like(t)
    for i in range(n_beats):
        beat_start = i * beat_sec
        click = (t >= beat_start) & (t < beat_start + 0.05)
        mono[click] += np.sin(2 * np.pi * 440 * (t[click] - beat_start))

    result = find_loop_point(mono, sr, min_loop_sec=1.0, window_sec=0.05)

    assert result is not None
    start, end = result
    assert 0 <= start < end <= len(mono)
    assert (end - start) >= int(1.0 * sr)


def test_returns_none_with_no_beats():
    sr = 22050
    mono = np.zeros(sr, dtype=np.float64)

    result = find_loop_point(mono, sr)

    assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lambda && pytest tests/test_loop_point.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'looper.loop_point'`

- [ ] **Step 3: Write minimal implementation**

`lambda/src/looper/loop_point.py`:
```python
import librosa
import numpy as np


def find_loop_point(
    mono: np.ndarray,
    sr: int,
    min_loop_sec: float = 2.0,
    window_sec: float = 0.05,
) -> tuple[int, int] | None:
    _, beat_frames = librosa.beat.beat_track(y=mono, sr=sr, units="frames")
    beats = librosa.frames_to_samples(beat_frames)
    if len(beats) < 2:
        return None

    w = int(window_sec * sr)
    min_len = int(min_loop_sec * sr)
    n = len(mono)

    best: tuple[int, int] | None = None
    best_score = -1.0

    for bi, i in enumerate(beats):
        if i + w > n:
            continue
        head = mono[i : i + w]
        head_norm = np.linalg.norm(head)
        if head_norm == 0:
            continue

        for j in beats[bi + 1 :]:
            if j - i < min_len:
                continue
            if j + w > n:
                break
            tail = mono[j : j + w]
            tail_norm = np.linalg.norm(tail)
            if tail_norm == 0:
                continue

            score = float(np.dot(head, tail) / (head_norm * tail_norm))
            if score > best_score:
                best_score = score
                best = (int(i), int(j))

    return best
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd lambda && pytest tests/test_loop_point.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lambda/src/looper/loop_point.py lambda/tests/test_loop_point.py
git commit -m "feat(lambda): add beat-aligned loop-point finder"
```

---

### Task 5: Crossfade

**Files:**
- Create: `lambda/src/looper/crossfade.py`
- Test: `lambda/tests/test_crossfade.py`

**Interfaces:**
- Produces: `crossfade_loop(y: np.ndarray, start: int, end: int, sr: int, fade_sec: float = 0.05) -> np.ndarray` — accepts `(n_samples,)` or `(n_samples, n_channels)`, returns the loop buffer with the seam blended (length `end - start - fade_len`).

- [ ] **Step 1: Write the failing test**

`lambda/tests/test_crossfade.py`:
```python
import numpy as np
from looper.crossfade import crossfade_loop


def test_crossfade_output_length_mono():
    sr = 44100
    y = np.random.RandomState(0).uniform(-0.5, 0.5, sr * 2)

    out = crossfade_loop(y, start=0, end=sr, sr=sr, fade_sec=0.05)

    fade_len = int(0.05 * sr)
    assert len(out) == sr - fade_len


def test_crossfade_no_nan_or_clipping():
    sr = 44100
    y = np.random.RandomState(1).uniform(-0.9, 0.9, sr * 2)

    out = crossfade_loop(y, start=0, end=sr, sr=sr, fade_sec=0.05)

    assert not np.isnan(out).any()
    assert np.max(np.abs(out)) <= 1.0 + 1e-6


def test_crossfade_preserves_stereo_shape():
    sr = 44100
    mono = np.random.RandomState(2).uniform(-0.5, 0.5, sr * 2)
    y = np.stack([mono, mono * 0.8], axis=1)

    out = crossfade_loop(y, start=0, end=sr, sr=sr, fade_sec=0.05)

    fade_len = int(0.05 * sr)
    assert out.shape == (sr - fade_len, 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lambda && pytest tests/test_crossfade.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'looper.crossfade'`

- [ ] **Step 3: Write minimal implementation**

`lambda/src/looper/crossfade.py`:
```python
import numpy as np


def crossfade_loop(
    y: np.ndarray,
    start: int,
    end: int,
    sr: int,
    fade_sec: float = 0.05,
) -> np.ndarray:
    loop = y[start:end]
    fade_len = min(int(fade_sec * sr), len(loop) // 2)

    t = np.linspace(0, np.pi / 2, fade_len)
    fade_out = np.cos(t)
    fade_in = np.sin(t)

    if loop.ndim == 2:
        fade_out = fade_out[:, None]
        fade_in = fade_in[:, None]

    head = loop[:fade_len]
    tail = loop[-fade_len:]
    blended = tail * fade_out + head * fade_in

    return np.concatenate([blended, loop[fade_len:-fade_len]], axis=0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd lambda && pytest tests/test_crossfade.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lambda/src/looper/crossfade.py lambda/tests/test_crossfade.py
git commit -m "feat(lambda): add equal-power seam crossfade"
```

---

### Task 6: Pipeline orchestrator

**Files:**
- Create: `lambda/src/looper/pipeline.py`
- Test: `lambda/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `normalize_loudness` (Task 2), `trim_silence` (Task 3), `find_loop_point` (Task 4), `crossfade_loop` (Task 5).
- Produces: `process(input_path: str, output_path: str, target_lufs: float = -14.0) -> None` — reads any soundfile-readable input, writes a looped, format-matched file to `output_path` (caller must give `output_path` the same extension as the input).

- [ ] **Step 1: Write the failing test**

`lambda/tests/test_pipeline.py`:
```python
import os
import numpy as np
import soundfile as sf
from looper.pipeline import process


def _write_fixture(path: str, sr: int = 22050, bpm: int = 120, n_beats: int = 16):
    beat_sec = 60 / bpm
    duration = beat_sec * n_beats
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    mono = 0.2 * np.sin(2 * np.pi * 220 * t)
    for i in range(n_beats):
        beat_start = i * beat_sec
        click = (t >= beat_start) & (t < beat_start + 0.05)
        mono[click] += 0.3 * np.sin(2 * np.pi * 880 * (t[click] - beat_start))
    stereo = np.stack([mono, mono], axis=1)
    sf.write(path, stereo, sr, subtype="PCM_16")


def test_process_produces_shorter_looped_wav(tmp_path):
    input_path = str(tmp_path / "input.wav")
    output_path = str(tmp_path / "output.wav")
    _write_fixture(input_path)

    process(input_path, output_path)

    assert os.path.exists(output_path)
    in_info = sf.info(input_path)
    out_info = sf.info(output_path)
    assert out_info.samplerate == in_info.samplerate
    assert out_info.channels == in_info.channels
    assert out_info.frames < in_info.frames
    assert out_info.frames > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lambda && pytest tests/test_pipeline.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'looper.pipeline'`

- [ ] **Step 3: Write minimal implementation**

`lambda/src/looper/pipeline.py`:
```python
import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf

from looper.crossfade import crossfade_loop
from looper.loop_point import find_loop_point
from looper.loudness import normalize_loudness
from looper.trim import trim_silence


def process(input_path: str, output_path: str, target_lufs: float = -14.0) -> None:
    y, sr = sf.read(input_path, always_2d=True)
    mono = np.mean(y, axis=1)

    start, end = trim_silence(mono, top_db=40.0)
    y = y[start:end]
    mono = mono[start:end]

    y = normalize_loudness(y, sr, target_lufs=target_lufs)
    mono = np.mean(y, axis=1)

    loop = find_loop_point(mono, sr)
    if loop is None:
        loop = (0, len(mono))
    loop_start, loop_end = loop

    y = crossfade_loop(y, loop_start, loop_end, sr)

    tmp_fd, tmp_wav = tempfile.mkstemp(suffix=".wav")
    os.close(tmp_fd)
    try:
        sf.write(tmp_wav, y, sr, subtype="PCM_16")
        subprocess.run(["ffmpeg", "-y", "-i", tmp_wav, output_path], check=True, capture_output=True)
    finally:
        os.remove(tmp_wav)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd lambda && pytest tests/test_pipeline.py -v`
Expected: PASS (requires `ffmpeg` on PATH locally — install it if the run fails with `FileNotFoundError: [Errno 2] No such file or directory: 'ffmpeg'`)

- [ ] **Step 5: Commit**

```bash
git add lambda/src/looper/pipeline.py lambda/tests/test_pipeline.py
git commit -m "feat(lambda): add pipeline orchestrator"
```

---

### Task 7: Lambda handler

**Files:**
- Create: `lambda/src/looper/handler.py`
- Test: `lambda/tests/test_handler.py`

**Interfaces:**
- Consumes: `process(input_path, output_path)` (Task 6).
- Produces: `handler(event: dict, context) -> dict` — `event` shape `{"bucket": str, "input_key": str, "output_key": str}`, returns `{"output_key": str}`. This is the exact contract the Terraform-provisioned Lambda and the `/api/process` route (Task 15) both rely on.

- [ ] **Step 1: Write the failing test**

`lambda/tests/test_handler.py`:
```python
import boto3
from moto import mock_aws
from looper import handler as handler_module


@mock_aws
def test_handler_downloads_processes_and_uploads(monkeypatch):
    bucket = "test-bucket"
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=bucket)
    s3.put_object(Bucket=bucket, Key="uploads/song.wav", Body=b"fake-audio-bytes")

    def fake_process(input_path, output_path, target_lufs=-14.0):
        with open(input_path, "rb") as f:
            data = f.read()
        with open(output_path, "wb") as f:
            f.write(data + b"-processed")

    monkeypatch.setattr(handler_module, "process", fake_process)

    result = handler_module.handler(
        {"bucket": bucket, "input_key": "uploads/song.wav", "output_key": "outputs/song.wav"},
        None,
    )

    assert result == {"output_key": "outputs/song.wav"}
    body = s3.get_object(Bucket=bucket, Key="outputs/song.wav")["Body"].read()
    assert body == b"fake-audio-bytes-processed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lambda && pip install moto pytest && pytest tests/test_handler.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'looper.handler'`

- [ ] **Step 3: Write minimal implementation**

`lambda/src/looper/handler.py`:
```python
import os

import boto3

from looper.pipeline import process

s3 = boto3.client("s3")


def handler(event: dict, context) -> dict:
    bucket = event["bucket"]
    input_key = event["input_key"]
    output_key = event["output_key"]

    ext = os.path.splitext(input_key)[1]
    input_path = os.path.join("/tmp", f"input{ext}")
    output_path = os.path.join("/tmp", f"output{ext}")

    s3.download_file(bucket, input_key, input_path)
    process(input_path, output_path)
    s3.upload_file(output_path, bucket, output_key)

    return {"output_key": output_key}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd lambda && pytest tests/test_handler.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lambda/src/looper/handler.py lambda/tests/test_handler.py
git commit -m "feat(lambda): add S3-wired Lambda handler"
```

---

### Task 8: Lambda container image

**Files:**
- Create: `lambda/Dockerfile`
- Modify: `lambda/requirements.txt` (no boto3 addition needed — base image ships it)

**Interfaces:**
- Consumes: `lambda/src/looper/` package (Tasks 2–7), `lambda/requirements.txt`.
- Produces: a Docker image tagged `bgm-looper-lambda:local` with `looper.handler.handler` as the Lambda entrypoint — this is the image Task 11 builds and pushes to ECR.

- [ ] **Step 1: Write the Dockerfile**

`lambda/Dockerfile`:
```dockerfile
FROM public.ecr.aws/lambda/python:3.12

RUN dnf install -y tar xz && \
    curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ffmpeg.tar.xz && \
    tar -xf /tmp/ffmpeg.tar.xz -C /tmp && \
    cp /tmp/ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ffmpeg && \
    rm -rf /tmp/ffmpeg*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY src/looper ${LAMBDA_TASK_ROOT}/looper

CMD ["looper.handler.handler"]
```

- [ ] **Step 2: Build the image locally**

Run: `cd lambda && docker build -t bgm-looper-lambda:local .`
Expected: build succeeds with no errors.

- [ ] **Step 3: Verify ffmpeg and the package import inside the image**

Run: `docker run --rm --entrypoint ffmpeg bgm-looper-lambda:local -version`
Expected: prints an ffmpeg version banner.

Run: `docker run --rm --entrypoint python bgm-looper-lambda:local -c "import looper.pipeline; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add lambda/Dockerfile
git commit -m "feat(lambda): add container image for Lambda deployment"
```

---

### Task 9: Terraform bootstrap (state bucket)

**Files:**
- Create: `infra/bootstrap/main.tf`
- Delete: `infra/bootstrap/.gitkeep`

**Interfaces:**
- Produces: an S3 bucket named `bgm-looper-tf-state-<account_id>`, output `state_bucket_name` — Task 10's `backend.tf` hardcodes this name (fill in your real account ID after Step 3 below).

- [ ] **Step 1: Write the bootstrap config**

`infra/bootstrap/main.tf`:
```hcl
terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "tf_state" {
  bucket = "bgm-looper-tf-state-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket                  = aws_s3_bucket.tf_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "state_bucket_name" {
  value = aws_s3_bucket.tf_state.bucket
}
```

- [ ] **Step 2: Validate and plan**

Prerequisite: AWS credentials for your personal account configured (`aws configure` or `AWS_PROFILE`).

Run: `cd infra/bootstrap && terraform init && terraform validate && terraform plan`
Expected: validate succeeds; plan shows 4 resources to add (bucket, versioning, encryption, public-access-block), 0 to change/destroy.

- [ ] **Step 3: Apply (one-time, manual)**

Run: `terraform apply`
Expected: after confirming, 4 resources created; output `state_bucket_name` printed. Note this value — Task 10 needs it verbatim.

- [ ] **Step 4: Commit**

```bash
git rm infra/bootstrap/.gitkeep
git add infra/bootstrap/main.tf
git commit -m "feat(infra): add Terraform bootstrap layer for state bucket"
```

---

### Task 10: Terraform main — backend, providers, S3 audio bucket

**Files:**
- Create: `infra/main/backend.tf`, `infra/main/providers.tf`, `infra/main/variables.tf`, `infra/main/s3.tf`, `infra/main/outputs.tf`
- Delete: `infra/main/.gitkeep`

**Interfaces:**
- Produces: `aws_s3_bucket.audio` (output `audio_bucket_name`) — Task 11's Lambda IAM policy and Task 12's `S3_BUCKET_NAME` env var both reference this resource.
- Consumes: `state_bucket_name` output from Task 9.

- [ ] **Step 1: Write backend and provider config**

`infra/main/backend.tf` (replace `<ACCOUNT_ID>` with the real value from Task 9, Step 3):
```hcl
terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "bgm-looper-tf-state-<ACCOUNT_ID>"
    key          = "main/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 1.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}
```

`infra/main/providers.tf`:
```hcl
provider "aws" {
  region = var.aws_region
}

provider "vercel" {
  api_token = var.vercel_api_token
}

data "aws_caller_identity" "current" {}
```

`infra/main/variables.tf`:
```hcl
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project_name" {
  type    = string
  default = "bgm-looper"
}

variable "vercel_api_token" {
  type      = string
  sensitive = true
}

variable "app_password" {
  type      = string
  sensitive = true
}

variable "github_repo" {
  description = "owner/repo of this project on GitHub, for Vercel git integration"
  type        = string
}
```

- [ ] **Step 2: Write the S3 audio bucket**

`infra/main/s3.tf`:
```hcl
resource "aws_s3_bucket" "audio" {
  bucket = "${var.project_name}-audio-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket                  = aws_s3_bucket.audio.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    id     = "expire-1-day"
    status = "Enabled"
    filter {}
    expiration {
      days = 1
    }
  }
}
```

`infra/main/outputs.tf`:
```hcl
output "audio_bucket_name" {
  value = aws_s3_bucket.audio.bucket
}
```

- [ ] **Step 3: Validate and plan**

Run: `cd infra/main && terraform init && terraform validate`
Expected: validate succeeds (init will complain about missing `vercel_api_token`/`app_password`/`github_repo` only when running `plan`/`apply`, not `validate`).

Run: `terraform plan -var="vercel_api_token=placeholder" -var="app_password=placeholder" -var="github_repo=youruser/looper"`
Expected: plan shows 4 S3-related resources to add, 0 to change/destroy (Vercel/Lambda/IAM resources don't exist yet — added in later tasks).

- [ ] **Step 4: Commit**

```bash
git rm infra/main/.gitkeep
git add infra/main/backend.tf infra/main/providers.tf infra/main/variables.tf infra/main/s3.tf infra/main/outputs.tf
git commit -m "feat(infra): add Terraform main layer with S3 audio bucket"
```

---

### Task 11: Terraform main — ECR, Lambda, execution role

**Files:**
- Create: `infra/main/ecr.tf`, `infra/main/lambda.tf`
- Modify: `infra/main/outputs.tf`

**Interfaces:**
- Consumes: `aws_s3_bucket.audio` (Task 10).
- Produces: `aws_lambda_function.looper` (outputs `lambda_function_name`) — Task 12's `LAMBDA_FUNCTION_NAME` env var and Task 15's `/api/process` route both reference this by name.

- [ ] **Step 1: Write the ECR repo**

`infra/main/ecr.tf`:
```hcl
resource "aws_ecr_repository" "looper" {
  name         = "${var.project_name}-lambda"
  force_delete = true
}
```

- [ ] **Step 2: Write the Lambda function and its execution role**

`infra/main/lambda.tf`:
```hcl
resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_s3" {
  name = "${var.project_name}-lambda-s3"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = "${aws_s3_bucket.audio.arn}/*"
    }]
  })
}

resource "aws_lambda_function" "looper" {
  function_name = "${var.project_name}-processor"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.looper.repository_url}:latest"
  timeout       = 60
  memory_size   = 1024

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.lambda_s3]
}
```

- [ ] **Step 3: Add outputs**

Add to `infra/main/outputs.tf`:
```hcl
output "ecr_repository_url" {
  value = aws_ecr_repository.looper.repository_url
}

output "lambda_function_name" {
  value = aws_lambda_function.looper.function_name
}
```

- [ ] **Step 4: Create the ECR repo first (image must exist before the Lambda function can reference it)**

Run: `cd infra/main && terraform apply -target=aws_ecr_repository.looper -var="vercel_api_token=placeholder" -var="app_password=placeholder" -var="github_repo=youruser/looper"`
Expected: only the ECR repo is created.

- [ ] **Step 5: Build and push the Lambda image**

Run:
```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
cd lambda
docker build -t bgm-looper-lambda:latest .
docker tag bgm-looper-lambda:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/bgm-looper-lambda:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/bgm-looper-lambda:latest
```
Expected: push succeeds, image visible in the ECR console/`aws ecr list-images`.

- [ ] **Step 6: Apply the rest**

Run: `cd infra/main && terraform apply -var="vercel_api_token=placeholder" -var="app_password=placeholder" -var="github_repo=youruser/looper"`
Expected: IAM role, policy, and Lambda function created.

- [ ] **Step 7: Verify with a real invoke**

Manually upload a small test WAV to `s3://<audio_bucket_name>/uploads/test.wav`, then:

Run:
```bash
aws lambda invoke --function-name bgm-looper-processor \
  --payload '{"bucket":"<audio_bucket_name>","input_key":"uploads/test.wav","output_key":"outputs/test.wav"}' \
  --cli-binary-format raw-in-base64-out out.json
cat out.json
```
Expected: `{"output_key": "outputs/test.wav"}`, and `outputs/test.wav` exists in the bucket.

- [ ] **Step 8: Commit**

```bash
git add infra/main/ecr.tf infra/main/lambda.tf infra/main/outputs.tf
git commit -m "feat(infra): add ECR repo and Lambda function for DSP processing"
```

---

### Task 12: Terraform main — IAM service-account user + Vercel project/env vars

**Files:**
- Create: `infra/main/iam.tf`, `infra/main/vercel.tf`
- Modify: `infra/main/outputs.tf`

**Interfaces:**
- Consumes: `aws_s3_bucket.audio` (Task 10), `aws_lambda_function.looper` (Task 11).
- Produces: a Vercel project with env vars `APP_PASSWORD`, `COOKIE_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `APP_AWS_REGION`, `S3_BUCKET_NAME`, `LAMBDA_FUNCTION_NAME` — every Next.js route in Tasks 13–15 reads these exact names via `process.env`.

- [ ] **Step 1: Write the IAM service-account user**

`infra/main/iam.tf`:
```hcl
resource "aws_iam_user" "vercel" {
  name = "${var.project_name}-vercel-sa"
}

resource "aws_iam_access_key" "vercel" {
  user = aws_iam_user.vercel.name
}

resource "aws_iam_user_policy" "vercel" {
  name = "${var.project_name}-vercel-policy"
  user = aws_iam_user.vercel.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.audio.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.looper.arn
      }
    ]
  })
}
```

- [ ] **Step 2: Write the Vercel project and env vars**

`infra/main/vercel.tf`:
```hcl
resource "random_password" "cookie_secret" {
  length  = 32
  special = false
}

resource "vercel_project" "looper" {
  name           = var.project_name
  framework      = "nextjs"
  root_directory = "app"

  git_repository = {
    type = "github"
    repo = var.github_repo
  }
}

locals {
  env_targets = ["production", "preview"]
}

resource "vercel_project_environment_variable" "app_password" {
  project_id = vercel_project.looper.id
  key        = "APP_PASSWORD"
  value      = var.app_password
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "cookie_secret" {
  project_id = vercel_project.looper.id
  key        = "COOKIE_SECRET"
  value      = random_password.cookie_secret.result
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "aws_access_key" {
  project_id = vercel_project.looper.id
  key        = "AWS_ACCESS_KEY_ID"
  value      = aws_iam_access_key.vercel.id
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "aws_secret_key" {
  project_id = vercel_project.looper.id
  key        = "AWS_SECRET_ACCESS_KEY"
  value      = aws_iam_access_key.vercel.secret
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "aws_region" {
  project_id = vercel_project.looper.id
  key        = "APP_AWS_REGION"
  value      = var.aws_region
  target     = local.env_targets
}

resource "vercel_project_environment_variable" "s3_bucket" {
  project_id = vercel_project.looper.id
  key        = "S3_BUCKET_NAME"
  value      = aws_s3_bucket.audio.bucket
  target     = local.env_targets
}

resource "vercel_project_environment_variable" "lambda_function_name" {
  project_id = vercel_project.looper.id
  key        = "LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.looper.function_name
  target     = local.env_targets
}
```

- [ ] **Step 3: Add sensitive outputs**

Add to `infra/main/outputs.tf`:
```hcl
output "vercel_project_id" {
  value = vercel_project.looper.id
}

output "vercel_access_key_id" {
  value     = aws_iam_access_key.vercel.id
  sensitive = true
}
```

- [ ] **Step 4: Validate, plan, and apply**

Run: `cd infra/main && terraform validate`
Expected: succeeds.

Run: `terraform plan -var="vercel_api_token=<real token>" -var="app_password=<your chosen password>" -var="github_repo=<youruser>/looper"`
Expected: plan adds IAM user/key/policy + Vercel project + 7 env vars, 0 destroy.

Run: `terraform apply` (same vars)
Expected: resources created; confirm in the Vercel dashboard that the project exists with all 7 env vars set.

- [ ] **Step 5: Commit**

```bash
git add infra/main/iam.tf infra/main/vercel.tf infra/main/outputs.tf
git commit -m "feat(infra): add Vercel service-account IAM user and Vercel project/env vars"
```

---

### Task 13: Next.js auth (password + signed cookie)

**Files:**
- Create: `app/lib/auth.ts`, `app/middleware.ts`, `app/app/api/login/route.ts`, `app/app/login/page.tsx`
- Test: `app/lib/auth.test.ts`

**Interfaces:**
- Produces: `COOKIE_NAME: string`, `createSessionCookieValue(secret: string): string`, `verifySessionCookieValue(cookieValue: string | undefined, secret: string): boolean`, `checkPassword(submitted: string, actual: string): boolean` — Task 14 and 15's routes rely on the middleware already gating them; no other task calls these directly.
- Env vars consumed: `APP_PASSWORD`, `COOKIE_SECRET` (both provisioned by Task 12).

- [ ] **Step 1: Write the failing test**

`app/lib/auth.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { checkPassword, createSessionCookieValue, verifySessionCookieValue } from "./auth";

describe("createSessionCookieValue / verifySessionCookieValue", () => {
  it("round-trips a valid cookie", () => {
    const secret = "test-secret";
    const value = createSessionCookieValue(secret);
    expect(verifySessionCookieValue(value, secret)).toBe(true);
  });

  it("rejects a tampered cookie", () => {
    const secret = "test-secret";
    const value = createSessionCookieValue(secret);
    expect(verifySessionCookieValue(value + "x", secret)).toBe(false);
  });

  it("rejects a cookie signed with a different secret", () => {
    const value = createSessionCookieValue("secret-a");
    expect(verifySessionCookieValue(value, "secret-b")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(verifySessionCookieValue(undefined, "test-secret")).toBe(false);
  });
});

describe("checkPassword", () => {
  it("accepts the correct password", () => {
    expect(checkPassword("hunter2", "hunter2")).toBe(true);
  });

  it("rejects an incorrect password", () => {
    expect(checkPassword("wrong", "hunter2")).toBe(false);
  });

  it("rejects a different-length password without throwing", () => {
    expect(checkPassword("short", "a-much-longer-password")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- auth.test.ts`
Expected: FAIL — `./auth` module not found.

- [ ] **Step 3: Write minimal implementation**

`app/lib/auth.ts`:
```typescript
import { createHmac, timingSafeEqual } from "crypto";

export const COOKIE_NAME = "looper_session";

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function createSessionCookieValue(secret: string): string {
  const payload = "authenticated";
  const sig = sign(payload, secret);
  return `${payload}.${sig}`;
}

export function verifySessionCookieValue(
  cookieValue: string | undefined,
  secret: string,
): boolean {
  if (!cookieValue) return false;
  const [payload, sig] = cookieValue.split(".");
  if (!payload || !sig) return false;

  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function checkPassword(submitted: string, actual: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- auth.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the middleware**

`app/middleware.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionCookieValue } from "./lib/auth";

export function middleware(request: NextRequest) {
  if (
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/api/login"
  ) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  const secret = process.env.COOKIE_SECRET!;

  if (!verifySessionCookieValue(cookie, secret)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 6: Write the login route and page**

`app/app/api/login/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSessionCookieValue, COOKIE_NAME } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  if (!checkPassword(password ?? "", process.env.APP_PASSWORD!)) {
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    COOKIE_NAME,
    createSessionCookieValue(process.env.COOKIE_SECRET!),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    },
  );
  return response;
}
```

`app/app/login/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError("Invalid password");
      return;
    }
    router.push("/");
  }

  return (
    <main>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        <button type="submit">Log in</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Manual verification**

Run: `cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev`
Expected: visiting `http://localhost:3000/` redirects to `/login`; submitting the wrong password shows "Invalid password"; submitting `test123` redirects to `/` and stays there on refresh.

- [ ] **Step 8: Commit**

```bash
git add app/lib/auth.ts app/lib/auth.test.ts app/middleware.ts app/app/api/login/route.ts app/app/login/page.tsx
git commit -m "feat(app): add single-user password auth with signed cookie"
```

---

### Task 14: Upload-URL route

**Files:**
- Create: `app/lib/aws.ts`, `app/app/api/upload-url/route.ts`
- Test: `app/lib/aws.test.ts`

**Interfaces:**
- Produces: `keyForUpload(filename: string): string` (returns `uploads/<uuid><ext>`), `presignUpload(key: string, contentType: string): Promise<string>`, `presignDownload(key: string): Promise<string>`, `getS3Client(): S3Client`. Task 15 imports `presignDownload` and `getS3Client` (or reuses the S3 client pattern) from this same file.
- Env vars consumed: `APP_AWS_REGION`, `S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (all provisioned by Task 12; the AWS SDK reads the last two automatically).

- [ ] **Step 1: Write the failing test**

`app/lib/aws.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { keyForUpload } from "./aws";

describe("keyForUpload", () => {
  it("prefixes with uploads/ and preserves the extension", () => {
    const key = keyForUpload("my song.mp3");
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}\.mp3$/);
  });

  it("handles filenames with no extension", () => {
    const key = keyForUpload("noext");
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- aws.test.ts`
Expected: FAIL — `./aws` module not found.

- [ ] **Step 3: Write minimal implementation**

Install SDK presigner: `cd app && npm install @aws-sdk/s3-request-presigner`

`app/lib/aws.ts`:
```typescript
import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function getS3Client(): S3Client {
  return new S3Client({ region: process.env.APP_AWS_REGION! });
}

export function keyForUpload(filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  return `uploads/${randomUUID()}${ext}`;
}

export async function presignUpload(key: string, contentType: string): Promise<string> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: 300 });
}

export async function presignDownload(key: string): Promise<string> {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: 300 });
}
```

`app/app/api/upload-url/route.ts`:
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- aws.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/lib/aws.ts app/lib/aws.test.ts app/app/api/upload-url/route.ts app/package.json app/package-lock.json
git commit -m "feat(app): add presigned S3 upload-url route"
```

---

### Task 15: Process route

**Files:**
- Create: `app/app/api/process/route.ts`
- Modify: `app/lib/aws.ts` (add `deriveOutputKey`)
- Test: `app/lib/aws.test.ts` (extend), `app/app/api/process/route.test.ts`

**Interfaces:**
- Consumes: `presignDownload`, `getS3Client` pattern (Task 14); Lambda handler contract `{bucket, input_key, output_key} -> {output_key}` (Task 7); `LAMBDA_FUNCTION_NAME` env var (Task 12).
- Produces: `deriveOutputKey(inputKey: string): string` (returns `outputs/<rest>` for a `uploads/<rest>` key), `POST` handler returning `{ downloadUrl: string }`.

- [ ] **Step 1: Write the failing test for `deriveOutputKey`**

Add to `app/lib/aws.test.ts`:
```typescript
import { deriveOutputKey } from "./aws";

describe("deriveOutputKey", () => {
  it("swaps the uploads/ prefix for outputs/", () => {
    expect(deriveOutputKey("uploads/abc-123.mp3")).toBe("outputs/abc-123.mp3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- aws.test.ts`
Expected: FAIL — `deriveOutputKey` is not exported.

- [ ] **Step 3: Add `deriveOutputKey` to `app/lib/aws.ts`**

```typescript
export function deriveOutputKey(inputKey: string): string {
  return inputKey.replace(/^uploads\//, "outputs/");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- aws.test.ts`
Expected: PASS

- [ ] **Step 5: Install the Lambda SDK client and write the process route**

Run: `cd app && npm install @aws-sdk/client-lambda`

`app/app/api/process/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { deriveOutputKey, presignDownload } from "@/lib/aws";

export async function POST(request: NextRequest) {
  const { key } = await request.json();
  const outputKey = deriveOutputKey(key);

  const client = new LambdaClient({ region: process.env.APP_AWS_REGION! });
  const command = new InvokeCommand({
    FunctionName: process.env.LAMBDA_FUNCTION_NAME!,
    InvocationType: "RequestResponse",
    Payload: Buffer.from(
      JSON.stringify({
        bucket: process.env.S3_BUCKET_NAME,
        input_key: key,
        output_key: outputKey,
      }),
    ),
  });

  const response = await client.send(command);
  if (response.FunctionError) {
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  const downloadUrl = await presignDownload(outputKey);
  return NextResponse.json({ downloadUrl });
}
```

- [ ] **Step 6: Manual verification (requires Task 11/12 infra applied)**

Run: `cd app && npm run dev`, log in, then `curl` the two routes in sequence with a real file, or exercise via the UI once Task 16 lands.
Expected: `/api/process` returns a `downloadUrl` that plays the processed audio.

- [ ] **Step 7: Commit**

```bash
git add app/lib/aws.ts app/lib/aws.test.ts app/app/api/process/route.ts app/package.json app/package-lock.json
git commit -m "feat(app): add process route invoking the Lambda DSP pipeline"
```

---

### Task 16: Upload / preview / download UI

**Files:**
- Create: `app/app/page.tsx`
- Test: `app/app/page.test.tsx`

**Interfaces:**
- Consumes: `/api/upload-url` (Task 14) and `/api/process` (Task 15) via `fetch`.

- [ ] **Step 1: Write the failing test**

`app/app/page.test.tsx`:
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
      json: async () => ({ downloadUrl: "https://s3/download" }),
    });
}

describe("Home", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchSequence());
  });

  it("uploads, processes, and shows a preview + download link", async () => {
    render(<Home />);
    const file = new File(["bytes"], "song.mp3", { type: "audio/mpeg" });
    const input = screen.getByLabelText(/choose/i, { selector: "input" }) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
        "href",
        "https://s3/download",
      );
    });
    expect(document.querySelector("audio")).toHaveAttribute("src", "https://s3/download");
  });

  it("shows an error message when processing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ key: "uploads/abc.mp3", uploadUrl: "https://s3/upload" }),
        })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false }),
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- page.test.tsx`
Expected: FAIL — `./page` module not found (or the file exists but lacks a `label` for the file input).

- [ ] **Step 3: Write minimal implementation**

`app/app/page.tsx`:
```tsx
"use client";
import { useState } from "react";

type Status = "idle" | "uploading" | "processing" | "done" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    setDownloadUrl(null);

    try {
      const urlRes = await fetch("/api/upload-url", {
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
      const processRes = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!processRes.ok) throw new Error("Processing failed");
      const { downloadUrl: url } = await processRes.json();

      setDownloadUrl(url);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  return (
    <main>
      <label>
        Choose a BGM file
        <input
          type="file"
          accept="audio/*"
          disabled={status === "uploading" || status === "processing"}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>

      {status === "uploading" && <p>Uploading…</p>}
      {status === "processing" && <p>Processing…</p>}
      {status === "error" && <p role="alert">{error}</p>}
      {status === "done" && downloadUrl && (
        <div>
          <audio controls loop src={downloadUrl} />
          <a href={downloadUrl} download>
            Download
          </a>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- page.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/app/page.tsx app/app/page.test.tsx
git commit -m "feat(app): add upload/preview/download UI"
```

---

### Task 17: Full end-to-end wiring and manual verification

**Files:**
- None created — this task wires deployed infra to the deployed app and verifies the whole system.

**Interfaces:**
- Consumes: everything from Tasks 1–16.

- [ ] **Step 1: Confirm the Lambda image is current**

If any change was made to `lambda/src` since Task 11 Step 5, rebuild and push:
```bash
cd lambda
docker build -t bgm-looper-lambda:latest .
docker tag bgm-looper-lambda:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/bgm-looper-lambda:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/bgm-looper-lambda:latest
aws lambda update-function-code --function-name bgm-looper-processor --image-uri <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/bgm-looper-lambda:latest
```

- [ ] **Step 2: Apply the full Terraform stack with real secrets**

Run (from `infra/main`, with real values — do not commit these):
```bash
terraform apply \
  -var="vercel_api_token=<your Vercel token>" \
  -var="app_password=<your chosen password>" \
  -var="github_repo=<youruser>/looper"
```
Expected: 0 errors; `vercel_project_id` output populated.

- [ ] **Step 3: Push the repo to GitHub to trigger the Vercel build**

Run: `git push origin main` (assumes the GitHub remote at `github_repo` already exists and is connected)
Expected: Vercel dashboard shows a new deployment building and succeeding.

- [ ] **Step 4: Manual end-to-end test with a real audio file**

Open the deployed Vercel URL, log in with the password, upload a real short BGM file (<5 min), wait through "Uploading…" → "Processing…", then listen to the looped preview player and confirm the loop is audibly seamless (no click/pop at the repeat point) and volume is consistent with typical streaming loudness.
Expected: preview loops cleanly; download link produces a file in the same format as the original upload.

- [ ] **Step 5: Verify the kill switch**

Run: `cd infra/main && terraform destroy` (with the same `-var` flags as Step 2)
Expected: Vercel project, Lambda, ECR repo, S3 audio bucket, and IAM resources are all removed. Confirm in both the AWS console and Vercel dashboard. The `infra/bootstrap` state bucket is untouched (never destroyed by this command).

- [ ] **Step 6: Re-apply to leave the app running (if desired)**

Run: `terraform apply` (same vars as Step 2) if you want the app live after verifying the kill switch works.

- [ ] **Step 7: Commit any leftover changes**

```bash
git status
# if lambda/src changed during this task and wasn't committed yet:
git add lambda/src
git commit -m "fix(lambda): final adjustments found during end-to-end testing"
```
