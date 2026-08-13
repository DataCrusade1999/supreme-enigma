# PDF Restorer — Future Phases (reference outline, not an approved spec)

Date: 2026-08-13

This is an informal outline of the work deferred out of
[Phase 1](2026-08-13-pdf-restorer-design.md) (the local core pipeline +
CLI). Nothing here is approved or locked in — each phase still needs its
own brainstorming session, design spec, and implementation plan before
work starts, same as Phase 1 did. This doc exists just so the shape of
what's coming is written down somewhere.

## Phase 2: Next.js tool page

A new gated tool page at `app/app/tools/pdf-restorer/`, following the
same shape as `bgm-looper` and `bgm-extractor`:

- Browser uploads the PDF directly to S3 via a presigned URL
  (`/api/pdf-restorer/upload-url`), same as the existing tools — Vercel
  never touches the raw file bytes.
- `route-gate.ts` gets `/tools/pdf-restorer` and `/api/pdf-restorer` added
  to `GATED_PREFIXES`, reusing the existing shared-password cookie — no
  new auth mechanism.
- **Open question carried into that phase's brainstorming**: sync or
  async invocation? `bgm-looper` calls Lambda synchronously and blocks on
  the response; `bgm-extractor` invokes async and has the browser poll,
  because Demucs runs for minutes. A multi-page book run through OCR +
  dewarp + optimize is likely closer to `bgm-extractor`'s runtime profile
  than `bgm-looper`'s — this needs a real decision, not an assumption,
  once Phase 3's Lambda timing is known from actual runs.
- UI: upload → processing indicator → download link for the restored
  PDF. Whether to show per-page progress (Phase 1's pipeline already
  returns per-page warnings) is a UI decision for that phase, not decided
  here.

## Phase 3: Lambda container + S3 trigger

- New sibling top-level directory (e.g. `lambda-pdf-restorer/`), mirroring
  `lambda/`'s internal shape (`src/`, `tests/`, `Dockerfile`,
  `requirements.txt`, `pytest.ini`).
- A thin `handler.py` wraps Phase 1's `pipeline.restore_pdf()` — this is
  the entire point of keeping `pipeline.py` AWS-free in Phase 1: download
  from S3 to a temp path, call `restore_pdf()` unchanged, upload the
  result back to S3. No changes to any Phase 1 module expected.
- Dockerfile installs the system dependencies Phase 1's `README.md`
  documents for local dev — Tesseract OCR + qpdf — the container-image
  equivalent of `looper/Dockerfile`'s `ffmpeg` install step.
- Terraform, following this repo's shared-vs-per-branch split
  (`shared.tf` / `environments.tf`):
  - Own ECR repo (or a new prefix in the existing one — a decision for
    that phase, weighing image size and lifecycle-policy cost the same
    way `bgm-extractor`'s spec did for Demucs).
  - New S3 bucket or reuse of an existing one — Phase 1's local pipeline
    has no opinion on this; it's a Terraform-phase decision.
  - New Lambda function(s), sized once real memory/timeout numbers exist
    from running Phase 1's pipeline on real book-length PDFs (page count
    and DPI both drive memory needs — OpenCV + PyMuPDF + Tesseract on a
    300-page book at 300 DPI has not been measured yet).
  - IAM: likely reuses the existing `lambda_exec` role pattern, scoped to
    whichever bucket is chosen.
- CI/CD: extend `.github/workflows/deploy.yml`'s `changes`/`deploy` jobs
  with a new path filter + duplicated deploy block, same pattern used for
  `lambda-demucs/`.

## Explicitly not decided by this document

Bucket choice, sync-vs-async invocation, Lambda memory/timeout sizing,
and whether to add a job-status mechanism are all real open questions —
none of them are answered here. Each gets resolved when that phase goes
through its own brainstorming session, informed by what Phase 1's actual
pipeline turns out to cost in time and memory once it's built and run
against real scanned books.
