# PDF Restorer — Design Spec (Phase 1: local core pipeline + CLI)

Date: 2026-08-13

## 1. Purpose

A free, open-source, fully local tool that turns a scanned or
photographed-book PDF into a high-quality searchable PDF: clean, deskew,
crop, and (best-effort) dewarp each page, add an invisible OCR text layer,
optimize file size without visible quality loss, and never modify the
original file. No paid services, no external APIs — everything runs on
local CPU via open-source libraries (Tesseract via `ocrmypdf`, OpenCV,
PyMuPDF).

This spec covers **Phase 1 only**: the core Python processing pipeline and
a CLI to drive it locally. Two follow-up phases are intentionally deferred
and get their own specs later:

- **Phase 2**: a gated tool page in the existing Next.js app
  (`web/app/tools/pdf-restorer/`), following the same shared-password-gate
  and S3-upload shape as BGM Looper / BGM Extractor.
- **Phase 3**: an AWS Lambda container handler (triggered by an S3 upload,
  writing the processed PDF back to S3), following `lambda/`'s
  `pipeline.py`/`handler.py` split.

Phase 1's module boundaries are chosen so Phases 2–3 can wire in later
without restructuring the core (see §3).

## 2. Why a hybrid pipeline (custom preprocessing + OCRmyPDF), not a pure wrapper or a from-scratch pipeline

Three approaches were considered:

- **Pure `ocrmypdf` wrapper.** `ocrmypdf` (MIT-licensed, wraps Tesseract)
  already does deskew, light cleaning, OCR text-layer insertion, and safe
  optimization out of the box. Fastest to build, but it has no true
  page-curvature dewarp or background/perspective cropping — it assumes a
  reasonably flat, already-cropped scan. Fine for a flatbed scanner, weak
  for phone photos of book pages (the primary use case named in the
  request).
- **Fully custom pipeline**, reimplementing OCR text-layer placement and
  PDF optimization instead of using `ocrmypdf`. Maximum control, but
  reinvents things that are genuinely hard to get right safely (accurate
  invisible-text positioning at the correct glyph coordinates,
  lossless-ish recompression) — high effort and bug risk for no benefit,
  since `ocrmypdf` already solves this well.
- **Hybrid (chosen).** A custom OpenCV stage handles what off-the-shelf
  tools don't — background/perspective crop and best-effort dewarp for
  photographed pages — then the corrected page images are handed to
  `ocrmypdf` for OCR-text-layer insertion and optimization, which it
  already does robustly. This targets the actual gap (photographed book
  pages) while reusing a proven tool for the hard, already-solved parts.

## 3. Architecture

New top-level directory, sibling to `lambda/` and `web/`, matching this
repo's "independent sibling projects" convention:

```
pdf-restorer/
  requirements.txt
  pytest.ini                    # pythonpath = src, same as lambda/pytest.ini
  README.md                     # incl. system deps: Tesseract OCR engine,
                                 # Ghostscript — apt/brew/choco install steps
  src/pdfrestore/
    __init__.py
    cli.py                      # argparse entrypoint, local-only, no AWS
    pipeline.py                 # pure fn: restore_pdf(input_path,
                                 #   output_path, options) -> Result
    rasterize.py                # PDF -> page images (PyMuPDF/fitz —
                                 #   no poppler system dependency)
    preprocess.py                # OpenCV: crop/perspective-correct,
                                 #   deskew, dewarp, denoise
    assemble.py                 # corrected images -> intermediate PDF
                                 #   (img2pdf, lossless image embedding)
    ocr.py                       # ocrmypdf wrapper: text layer + optimize
  tests/
    conftest.py
    test_rasterize.py
    test_preprocess.py
    test_ocr.py
    test_pipeline.py
    test_cli.py
```

`pipeline.py` takes local file paths and an options object — no S3 client,
no AWS SDK import, no knowledge of buckets or events. This mirrors
`lambda/src/looper/pipeline.py` vs. `handler.py`: Phase 3's future
`handler.py` would just download from S3 to a temp path, call
`restore_pdf()`, and upload the result — no changes to `pipeline.py`
itself required.

## 4. Per-page processing pipeline

1. **Rasterize** (`rasterize.py`): each PDF page is rendered to an image at
   a configurable DPI (default 300) via PyMuPDF (`fitz`). PyMuPDF bundles
   MuPDF as a pure Python wheel — no system-level `poppler` dependency,
   which also keeps a future Lambda container image simpler (one less
   `dnf install` line, matching how `looper`'s Dockerfile only needs to
   install `ffmpeg`).

2. **Preprocess** (`preprocess.py`), per page, using OpenCV:
   - **Background/perspective crop**: find the page's quadrilateral
     against the background (contour detection) and perspective-warp it to
     a rectangle. Handles the common "photo of a page on a table, camera
     not perfectly overhead" case.
   - **Deskew**: fine rotation correction after perspective correction
     (`minAreaRect` on the detected text mask).
   - **Dewarp**: best-effort curvature correction for photographed
     book-page curl (e.g. near the spine), gated behind a `--dewarp` CLI
     flag, **off by default**. True page-curvature dewarping is an
     open-ended problem; this is a best-effort heuristic, not a guarantee,
     and is documented as such in the README rather than silently implied
     to be perfect.
   - **Denoise + contrast normalization**: mild denoising plus CLAHE
     contrast normalization to improve OCR accuracy without visibly
     degrading the page for a human reader. No forced grayscale or
     binarization — color and visual quality are preserved, per the
     "preserve visual quality" requirement.
   - Any single-page preprocessing failure is caught, logged as a warning,
     and that page falls back to its un-warped rasterized image rather
     than aborting the whole file — one bad page shouldn't sink an entire
     book.

3. **Assemble** (`assemble.py`): corrected page images are embedded into an
   intermediate PDF, in original page order, via `img2pdf` — chosen
   specifically because it embeds images losslessly (no JPEG
   re-encoding/generation-loss step), matching the "optimize without
   unnecessary quality loss" requirement.

4. **OCR + finalize** (`ocr.py`): the intermediate PDF is passed to
   `ocrmypdf.ocr()` (Python API, not shelling out to its CLI) with:
   - No `force_ocr` and no `deskew`. Both make ocrmypdf re-rasterize the
     page and replace the lossless image from step 3, and our own stage
     has already deskewed. The intermediate PDF has no text layer, so the
     default mode OCRs every page anyway.
   - `optimize=1` — the safe, effectively-lossless optimization level
     (image recompression without quality-reducing transforms), not the
     lossier `optimize=3`.
   - `output_type="pdf"` — a plain PDF, not forced to PDF/A, to stay
     closest to a normal viewable/printable output; nothing in the
     requirements calls for archival PDF/A.
   - `language` passed through from the CLI (default `eng`), letting users
     OCR non-English books provided the matching Tesseract language pack
     is installed.

5. **Write output**: the final PDF is written to a temp path first, then
   moved to the requested output path only on success. The input file is
   opened read-only throughout and never written to — enforced in tests
   via a before/after hash comparison (§6). If no output path is given,
   default is `<input-stem>.ocr.pdf` next to the input, never overwriting
   the original filename.

## 5. CLI (`cli.py`)

```
python -m pdfrestore INPUT.pdf [-o OUTPUT.pdf] [--dpi 300] [--dewarp] [--lang eng]
python -m pdfrestore --batch INPUT_DIR [-o OUTPUT_DIR] [--dpi 300] [--dewarp] [--lang eng]
```

Batch mode processes every `.pdf` in a directory, continues past
individual file failures (doesn't abort the whole batch on one bad file),
and prints a per-file pass/fail summary at the end, exiting non-zero if
any file failed. A missing system dependency (Tesseract, Ghostscript) is
detected at startup with an actionable error message naming the install
command for the current platform, rather than failing deep inside the
pipeline with an opaque traceback.

## 6. Testing (TDD, matches `lambda/`'s pytest convention)

- **Unit tests per stage**, using synthetic images generated in the test
  itself (e.g. a rotated white rectangle on a black background to verify
  `deskew` corrects the angle within tolerance) — no need for real
  scanned-book fixtures or committed binary test assets.
- **Integration test** (`test_pipeline.py`): build a synthetic
  "scanned-looking" PDF in-test (draw text on an image with PIL, rotate
  it slightly, save as a PDF page), run `restore_pdf()`, and assert:
  - the output PDF's extracted text (via PyMuPDF) matches the source text,
  - the output has more pages/images than zero and preserves page count
    and order,
  - the **input file's bytes are unchanged** (SHA-256 hash before/after),
    directly enforcing the "never modify the original" requirement.
- **CLI tests** (`test_cli.py`): argument parsing, batch mode over a
  temp directory with a mix of valid/invalid PDFs, and correct exit codes.

## 7. Explicitly out of scope for Phase 1 (YAGNI)

- Next.js tool page, API routes, or any browser-facing UI (Phase 2).
- Lambda handler, Dockerfile, S3/Terraform changes, or any AWS dependency
  in `pipeline.py` (Phase 3).
- PDF/A archival output mode.
- A GUI/desktop app.
- Multi-language OCR beyond passing through Tesseract's `--lang` — no
  automatic language detection.
- Perfect page-curvature dewarping — `--dewarp` is explicitly best-effort.
- Password-protected/encrypted input PDFs.
