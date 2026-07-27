# BGM Looper — Design Spec

Date: 2026-07-27

## 1. Purpose

Single-user web app: upload a background-music audio file, get back an edited
version of the same file that loops seamlessly (no audible seam, consistent
loudness, beat-aligned loop point). Hosted on Vercel. Heavy audio DSP runs on
the user's personal AWS account (Lambda + S3). All infra defined in Terraform
so the entire stack (AWS + Vercel) can be torn down with one command.

## 2. Architecture

```
Browser
  │  (login)
  ▼
Vercel (Next.js) ── thin API only, never touches raw audio bytes
  │
  ├─ /api/upload-url  → presigned S3 PUT URL
  ├─ /api/process      → sync-invokes AWS Lambda
  └─ (result)          → presigned S3 GET URL
  │
  ▼
AWS (personal account, provisioned by Terraform)
  ├─ S3 bucket   : uploads/, outputs/ (24h lifecycle expiry)
  ├─ Lambda      : container image (librosa, numpy, soundfile,
  │                 pyloudnorm, ffmpeg) — the DSP pipeline
  └─ IAM user    : least-privilege, scoped to this bucket + this Lambda only
```

Browser talks to S3 directly for the actual file bytes (presigned PUT/GET);
Vercel only ever handles small JSON requests. This keeps Vercel functions
fast and avoids Vercel's request body size limits.

## 3. Auth (single user)

No Cognito/NextAuth/user table — there is exactly one user.

- Password stored as a Vercel env var.
- `/api/login` compares submitted password to it (constant-time compare),
  sets an HttpOnly, signed cookie on success.
- Next.js middleware gates every page/API route on that cookie.

## 4. Processing pipeline (Lambda)

Python container image: `librosa`, `numpy`, `soundfile`, `pyloudnorm`, `ffmpeg`.

1. Load audio, keep native sample rate/channel count.
2. Loudness-normalize to a target LUFS (e.g. -14) with a true-peak limiter
   guard so normalization never clips.
3. Trim near-silence from head/tail.
4. Beat-track to get tempo + beat frame positions.
5. Loop-point search: scan candidate start/end pairs snapped to the beat
   grid, score each by waveform/spectral similarity between the tail and
   head windows, keep the best-scoring pair (minimizes audible discontinuity).
6. Equal-power crossfade over a short overlap at the seam (tail blended
   into head).
7. Encode back out via ffmpeg to the **input's original format/codec**.

Output is a single seamless-loop-ready file — no separate "preview render";
the browser's `<audio loop>` handles repetition for preview.

## 5. Data flow

```
Browser →(login)→ cookie set
Browser →/api/upload-url→ Vercel →(presigned PUT)→ S3 uploads/{uuid}.{ext}
Browser →PUT raw file→ S3 directly
Browser →/api/process {key}→ Vercel → Lambda (sync invoke)
  Lambda: download from S3 → DSP pipeline → upload S3 outputs/{uuid}.{ext}
  Lambda → returns output key to Vercel
Vercel → presigned GET URL → Browser
Browser: <audio loop src=presignedURL> for preview + a download link
```

Given files are short (<5 min, <20MB), Lambda runtime is ~10–20s — well
within a synchronous Vercel function call, so no polling/queue/status-table
is needed. This is a deliberate simplification: if file sizes grow later,
revisit as async (Lambda async invoke + S3 status object + client polling).

S3 lifecycle rule deletes all objects in `uploads/` and `outputs/` after 24h
— no manual cleanup, storage cost stays ~0.

## 6. Infrastructure as Code (Terraform) — the kill switch

Two layers, because Terraform can't manage the bucket that holds its own
state:

**`infra/bootstrap/`** — applied once, manually, local state (not remote).
Creates only the Terraform state bucket: versioned, SSE encrypted, all
public access blocked, IAM-restricted to the account owner. Holds no user
audio data and costs fractions of a cent. This layer is *not* part of the
kill switch — it's a one-time setup, not app infrastructure.

**`infra/main/`** — remote state (S3 backend, native S3 locking,
Terraform ≥1.10, no DynamoDB lock table needed). Manages everything that
actually constitutes "the app" and everything that could incur ongoing
AWS cost:
- S3 bucket (uploads/outputs) + lifecycle rule
- ECR repo + Lambda function (container image) + its execution IAM role
- IAM user + policy for Vercel's server-side AWS SDK calls (scoped to just
  this bucket's objects + `lambda:InvokeFunction` on just this function)
- Vercel project (via the Vercel Terraform provider): repo link, build
  settings, and all env vars (password secret, AWS access key/secret for
  the IAM user above, S3 bucket name, Lambda function name)

`terraform destroy` in `infra/main/` removes the entire application —
AWS side and Vercel side — in one command. `terraform apply` stands the
whole thing back up. This is the kill switch.

**Secrets-in-state caveat:** Vercel env vars (AWS keys, password) are
written into Terraform state as resource attributes — unavoidable with
the Vercel provider. Mitigations:
- State lives only in the encrypted, private bootstrap bucket (never git).
- All sensitive variables/outputs marked `sensitive = true` so values don't
  print in plan/apply/CLI output or CI logs.
- The IAM user's keys are scoped to nothing but this one bucket and this
  one Lambda — a leak of this state file exposes a low-blast-radius
  credential, not account-wide access.
- No root/account credentials ever touch Terraform or Vercel env vars.

## 7. Cost & sizing

Lambda: 1024MB memory, 60s timeout, container image, ~10–20s actual
runtime per file → roughly $0.0003/run. S3: pennies for storage +
requests at this volume. No EC2, no RDS, no always-on compute. Expected
real-world cost: $0/month, covered by AWS free tier at single-user usage
levels.

## 8. Error handling

- Corrupt/unsupported input file → Lambda returns an error, Vercel surfaces
  the message to the browser. No retry loop — single-shot, user can just
  re-upload.
- Upload or processing timeout → UI shows a retry button. No job
  queue/database — stateless by design, appropriate for one user at low
  volume.

## 9. Testing

- Unit tests for the loop-point scoring function using synthetic sine-wave
  loops with a known, deliberately-introduced seam (verify it finds the
  correct point).
- Unit test for the loudness-normalize step against a known target LUFS.
- Manual end-to-end test: run a real BGM file through the deployed app and
  listen to the looped preview.

## 10. Explicitly out of scope (YAGNI)

- Multi-user accounts / signup / OAuth.
- Async job queue, status database, or polling infra (revisit only if
  files grow well beyond ~5 min / 20MB).
- Pre-rendered multi-repeat preview file (the `<audio loop>` tag handles
  this in-browser for free).
- Managing the Terraform state bucket itself as part of the kill switch
  (it holds no app data and no meaningful cost).
