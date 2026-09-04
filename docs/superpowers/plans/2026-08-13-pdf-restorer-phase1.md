# PDF Restorer Phase 1 (Core Pipeline + CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and test, entirely locally, a Python pipeline and CLI that turns a scanned/photographed-book PDF into a searchable, high-quality PDF — never modifying the original file.

**Architecture:** A custom OpenCV preprocessing stage (background/perspective crop, deskew, best-effort dewarp, denoise) corrects each rasterized page image; corrected pages are reassembled losslessly into an intermediate PDF; `ocrmypdf` (wrapping Tesseract) adds the invisible OCR text layer and applies safe optimization. `pipeline.py` orchestrates these as pure local-file-path functions with zero AWS dependencies, so a future Lambda `handler.py` can wrap it without changes.

**Tech Stack:** Python 3.12, PyMuPDF (`fitz`), OpenCV (`opencv-python-headless`), NumPy, `img2pdf`, `ocrmypdf` (Tesseract + qpdf), Pillow, pytest.

**Spec:** `docs/superpowers/specs/2026-08-13-pdf-restorer-design.md`

## Global Constraints

- Target Python 3.12 (matches `lambda/`'s runtime).
- Core processing modules (`rasterize.py`, `preprocess.py`, `assemble.py`, `ocr.py`, `pipeline.py`) must never import `boto3` or any AWS SDK — they operate only on local file paths / in-memory arrays (spec §3).
- The input PDF is never opened for writing; `pipeline.restore_pdf` writes only to a temp path and moves it into place on success (spec §4.5).
- `ocrmypdf.ocr()` must be called with `optimize=1`, never the lossier `optimize=3` (spec §4.4).
- Dewarping defaults to **off** everywhere (`dewarp_enabled=False` / `--dewarp` flag) — best-effort, opt-in only (spec §4.2).
- `pytest.ini` sets `pythonpath = src`, matching `lambda/pytest.ini`'s convention.
- Dependency versions pinned as ranges (`>=X,<Y`), matching `lambda/requirements.txt`'s style.
- All new files live under a new top-level `pdf-restorer/` directory, sibling to `lambda/` and `app/`.

---

### Task 1: Project scaffolding

**Files:**
- Create: `pdf-restorer/requirements.txt`
- Create: `pdf-restorer/pytest.ini`
- Create: `pdf-restorer/README.md`
- Create: `pdf-restorer/src/pdfrestore/__init__.py`

**Interfaces:**
- Produces: an installable `pdfrestore` package skeleton and documented system dependencies. No functions yet.

- [ ] **Step 1: Create the directory structure and scaffold files**

```bash
mkdir -p pdf-restorer/src/pdfrestore pdf-restorer/tests
```

`pdf-restorer/requirements.txt`:
```
PyMuPDF>=1.24,<2.0
opencv-python-headless>=4.9,<5.0
numpy>=1.26,<2.0
img2pdf>=0.5,<0.6
ocrmypdf>=16.0,<17.0
Pillow>=10.1,<11.0
```

`pdf-restorer/pytest.ini`:
```ini
[pytest]
pythonpath = src
```

`pdf-restorer/src/pdfrestore/__init__.py`:
```python
```
(empty file — marks `pdfrestore` as a package)

`pdf-restorer/README.md`:
```markdown
# PDF Restorer

Turn a scanned or photographed-book PDF into a clean, searchable PDF —
deskewed, cropped, denoised, OCR'd, and optimized — entirely locally, with
no paid services or external APIs. The original PDF is never modified.

## System dependencies

This tool shells out to Tesseract OCR and qpdf (via `ocrmypdf`). Install
these before running it:

- **Windows**: `choco install tesseract qpdf` (or the UB Mannheim Tesseract
  installer, plus `qpdf` from https://github.com/qpdf/qpdf/releases)
- **macOS**: `brew install tesseract qpdf`
- **Linux (Debian/Ubuntu)**: `sudo apt install tesseract-ocr qpdf`

## Setup

```bash
cd pdf-restorer
python -m venv .venv
.venv/Scripts/activate  # or `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt pytest
```

## Usage

```bash
# Single file
python -m pdfrestore input.pdf -o output.pdf

# With options
python -m pdfrestore input.pdf -o output.pdf --dpi 300 --dewarp --lang eng

# Batch: process every PDF in a directory
python -m pdfrestore --batch ./scans -o ./restored
```

If `-o` is omitted for a single file, output defaults to
`<input-name>.ocr.pdf` next to the input file.

`--dewarp` enables best-effort correction for page curvature in
photographed book pages (e.g. near the spine). It's a heuristic, not a
guarantee — leave it off for flatbed scans, where it isn't needed.

## Tests

```bash
pytest -v
```

Tests that exercise real OCR are skipped automatically if Tesseract isn't
found on your PATH.
```

- [ ] **Step 2: Install dependencies and verify the package imports**

```bash
cd pdf-restorer
pip install -r requirements.txt pytest
python -c "import sys; sys.path.insert(0, 'src'); import pdfrestore; print('ok')"
```
Expected: prints `ok` with no errors.

- [ ] **Step 3: Commit**

```bash
git add pdf-restorer/requirements.txt pdf-restorer/pytest.ini pdf-restorer/README.md pdf-restorer/src/pdfrestore/__init__.py
git commit -m "$(cat <<'EOF'
chore(pdf-restorer): scaffold project skeleton

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 2: PDF rasterization

**Files:**
- Create: `pdf-restorer/src/pdfrestore/rasterize.py`
- Create: `pdf-restorer/tests/conftest.py`
- Create: `pdf-restorer/tests/test_rasterize.py`

**Interfaces:**
- Produces: `rasterize.rasterize_pdf(pdf_path: str, dpi: int = 300) -> list[np.ndarray]` — one HxWx3 uint8 RGB array per page, in page order.
- Produces (test fixtures, reused by every later test file): `make_pdf_from_image(image: PIL.Image.Image, dpi: int = 300, name: str = "input.pdf") -> pathlib.Path` and `make_text_page_image(text: str, size: tuple[int, int] = (900, 1200), angle: float = 0.0) -> PIL.Image.Image`.

- [ ] **Step 1: Write conftest.py fixtures and the failing test**

`pdf-restorer/tests/conftest.py`:
```python
import io

import img2pdf
import pytest
from PIL import Image, ImageDraw, ImageFont


@pytest.fixture
def make_pdf_from_image(tmp_path):
    def _make(image: Image.Image, dpi: int = 300, name: str = "input.pdf"):
        pdf_path = tmp_path / name
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", dpi=(dpi, dpi))
        pdf_bytes = img2pdf.convert(buffer.getvalue())
        pdf_path.write_bytes(pdf_bytes)
        return pdf_path

    return _make


@pytest.fixture
def make_text_page_image():
    def _make(text: str, size: tuple[int, int] = (900, 1200), angle: float = 0.0) -> Image.Image:
        image = Image.new("RGB", size, "white")
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=48)
        draw.text((60, 60), text, fill="black", font=font)
        if angle:
            image = image.rotate(angle, expand=True, fillcolor="white")
        return image

    return _make
```

`pdf-restorer/tests/test_rasterize.py`:
```python
import numpy as np

from pdfrestore import rasterize


def test_rasterize_pdf_returns_one_image_per_page(make_pdf_from_image, make_text_page_image):
    image = make_text_page_image("Rasterize check", size=(900, 1200))
    pdf_path = make_pdf_from_image(image, dpi=300, name="single_page.pdf")

    pages = rasterize.rasterize_pdf(str(pdf_path), dpi=300)

    assert len(pages) == 1
    page = pages[0]
    assert isinstance(page, np.ndarray)
    assert page.ndim == 3
    assert page.shape[2] == 3
    assert abs(page.shape[1] - 900) <= 4
    assert abs(page.shape[0] - 1200) <= 4


def test_rasterize_pdf_respects_dpi_scaling(make_pdf_from_image, make_text_page_image):
    image = make_text_page_image("DPI scaling check", size=(600, 800))
    pdf_path = make_pdf_from_image(image, dpi=300, name="dpi_check.pdf")

    pages_at_150 = rasterize.rasterize_pdf(str(pdf_path), dpi=150)

    assert abs(pages_at_150[0].shape[1] - 300) <= 4
    assert abs(pages_at_150[0].shape[0] - 400) <= 4
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd pdf-restorer
pytest tests/test_rasterize.py -v
```
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'pdfrestore.rasterize'`.

- [ ] **Step 3: Implement rasterize.py**

`pdf-restorer/src/pdfrestore/rasterize.py`:
```python
import fitz
import numpy as np


def rasterize_pdf(pdf_path: str, dpi: int = 300) -> list[np.ndarray]:
    images = []
    doc = fitz.open(pdf_path)
    try:
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        for page in doc:
            pix = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB)
            image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.height, pix.width, pix.n
            )
            images.append(image.copy())
    finally:
        doc.close()
    return images
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_rasterize.py -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add pdf-restorer/src/pdfrestore/rasterize.py pdf-restorer/tests/conftest.py pdf-restorer/tests/test_rasterize.py
git commit -m "$(cat <<'EOF'
feat(pdf-restorer): rasterize PDF pages to images via PyMuPDF

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 3: Deskew

**Files:**
- Create: `pdf-restorer/src/pdfrestore/preprocess.py`
- Create: `pdf-restorer/tests/test_preprocess.py`

**Interfaces:**
- Consumes: `make_text_page_image` fixture from Task 2's `conftest.py`.
- Produces: `preprocess.deskew(image: np.ndarray) -> np.ndarray`.

- [ ] **Step 1: Write the failing test**

`pdf-restorer/tests/test_preprocess.py`:
```python
import cv2
import numpy as np

from pdfrestore import preprocess


def _measure_skew_angle(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    return angle


def test_deskew_corrects_rotated_page(make_text_page_image):
    image = np.array(make_text_page_image("The quick brown fox jumps", angle=-7))

    corrected = preprocess.deskew(image)

    assert abs(_measure_skew_angle(corrected)) < 2.0
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_preprocess.py -v
```
Expected: FAIL — `AttributeError: module 'pdfrestore.preprocess' has no attribute 'deskew'` (or `ModuleNotFoundError` since the module doesn't exist yet).

- [ ] **Step 3: Implement deskew**

`pdf-restorer/src/pdfrestore/preprocess.py`:
```python
import logging

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def deskew(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if coords.size == 0:
        return image
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    if abs(angle) < 0.1:
        return image
    (h, w) = image.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(
        image, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_preprocess.py -v
```
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add pdf-restorer/src/pdfrestore/preprocess.py pdf-restorer/tests/test_preprocess.py
git commit -m "$(cat <<'EOF'
feat(pdf-restorer): add deskew correction

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 4: Background/perspective crop

**Files:**
- Modify: `pdf-restorer/src/pdfrestore/preprocess.py`
- Modify: `pdf-restorer/tests/test_preprocess.py`

**Interfaces:**
- Produces: `preprocess.crop_to_page(image: np.ndarray) -> np.ndarray` and private helper `preprocess._order_points(pts: np.ndarray) -> np.ndarray`.

- [ ] **Step 1: Write the failing test**

Append to `pdf-restorer/tests/test_preprocess.py`:
```python
from PIL import Image


def test_crop_to_page_removes_background(make_text_page_image):
    page = make_text_page_image("Chapter One", size=(700, 900))
    canvas = Image.new("RGB", (1200, 1500), (90, 90, 90))
    canvas.paste(page, (250, 300))
    arr = np.array(canvas)

    cropped = preprocess.crop_to_page(arr)

    assert cropped.shape[0] < arr.shape[0]
    assert cropped.shape[1] < arr.shape[1]
    assert cropped.mean() > arr.mean()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_preprocess.py -k crop_to_page -v
```
Expected: FAIL — `AttributeError: module 'pdfrestore.preprocess' has no attribute 'crop_to_page'`.

- [ ] **Step 3: Implement crop_to_page**

Append to `pdf-restorer/src/pdfrestore/preprocess.py`:
```python
def crop_to_page(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return image
    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < 0.2 * image.shape[0] * image.shape[1]:
        return image
    peri = cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, 0.02 * peri, True)
    if len(approx) != 4:
        rect = cv2.minAreaRect(largest)
        approx = cv2.boxPoints(rect).astype(np.float32).reshape(-1, 1, 2)
    pts = approx.reshape(4, 2).astype(np.float32)
    ordered = _order_points(pts)
    (tl, tr, br, bl) = ordered
    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_width = int(max(width_a, width_b))
    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_height = int(max(height_a, height_b))
    dst = np.array(
        [[0, 0], [max_width - 1, 0], [max_width - 1, max_height - 1], [0, max_height - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(ordered, dst)
    return cv2.warpPerspective(image, matrix, (max_width, max_height))


def _order_points(pts: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_preprocess.py -k crop_to_page -v
```
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add pdf-restorer/src/pdfrestore/preprocess.py pdf-restorer/tests/test_preprocess.py
git commit -m "$(cat <<'EOF'
feat(pdf-restorer): add background/perspective crop

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 5: Denoise and contrast enhancement

**Files:**
- Modify: `pdf-restorer/src/pdfrestore/preprocess.py`
- Modify: `pdf-restorer/tests/test_preprocess.py`

**Interfaces:**
- Produces: `preprocess.denoise_and_enhance(image: np.ndarray) -> np.ndarray`.

- [ ] **Step 1: Write the failing test**

Append to `pdf-restorer/tests/test_preprocess.py`:
```python
def test_denoise_and_enhance_reduces_local_noise(make_text_page_image):
    clean = np.array(make_text_page_image("Steady text", size=(400, 300)))
    rng = np.random.default_rng(42)
    noise = rng.normal(0, 25, clean.shape)
    noisy = np.clip(clean.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    result = preprocess.denoise_and_enhance(noisy)

    # Sample a flat background patch, away from the drawn text, to isolate noise level.
    patch_before = noisy[220:280, 250:350].astype(np.float64)
    patch_after = result[220:280, 250:350].astype(np.float64)

    assert result.shape == noisy.shape
    assert result.dtype == np.uint8
    assert patch_after.std() < patch_before.std()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_preprocess.py -k denoise_and_enhance -v
```
Expected: FAIL — `AttributeError: module 'pdfrestore.preprocess' has no attribute 'denoise_and_enhance'`.

- [ ] **Step 3: Implement denoise_and_enhance**

Append to `pdf-restorer/src/pdfrestore/preprocess.py`:
```python
def denoise_and_enhance(image: np.ndarray) -> np.ndarray:
    denoised = cv2.fastNlMeansDenoisingColored(
        image, None, h=5, hColor=5, templateWindowSize=7, searchWindowSize=21
    )
    lab = cv2.cvtColor(denoised, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    lab = cv2.merge((l, a, b))
    return cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_preprocess.py -k denoise_and_enhance -v
```
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add pdf-restorer/src/pdfrestore/preprocess.py pdf-restorer/tests/test_preprocess.py
git commit -m "$(cat <<'EOF'
feat(pdf-restorer): add denoise and contrast enhancement

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 6: Best-effort dewarp

**Files:**
- Modify: `pdf-restorer/src/pdfrestore/preprocess.py`
- Modify: `pdf-restorer/tests/test_preprocess.py`

**Interfaces:**
- Produces: `preprocess.dewarp(image: np.ndarray, enabled: bool = False) -> np.ndarray`.

- [ ] **Step 1: Write the failing tests**

Append to `pdf-restorer/tests/test_preprocess.py`:
```python
def _apply_sine_warp(image: np.ndarray, amplitude: float = 15.0) -> np.ndarray:
    h, w = image.shape[:2]
    map_x, map_y = np.meshgrid(np.arange(w), np.arange(h))
    shift = amplitude * np.sin(np.linspace(0, np.pi, w))
    map_y = (map_y + shift[np.newaxis, :]).astype(np.float32)
    map_x = map_x.astype(np.float32)
    return cv2.remap(image, map_x, map_y, interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def _measure_baseline_curvature(image: np.ndarray) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    w = thresh.shape[1]
    col_step = max(1, w // 40)
    rows = []
    for col in range(0, w, col_step):
        band = thresh[:, col : col + col_step]
        col_ink = band.sum(axis=1)
        if col_ink.max() > 0:
            rows.append(int(np.argmax(col_ink)))
    return float(np.std(rows)) if len(rows) >= 5 else 0.0


def test_dewarp_flattens_curved_text_line(make_text_page_image):
    straight = np.array(make_text_page_image("Curved baseline test line", size=(900, 300)))
    curved = _apply_sine_warp(straight)

    flattened = preprocess.dewarp(curved, enabled=True)

    assert _measure_baseline_curvature(flattened) < _measure_baseline_curvature(curved)


def test_dewarp_disabled_returns_input_unchanged():
    image = np.zeros((100, 100, 3), dtype=np.uint8)

    result = preprocess.dewarp(image, enabled=False)

    assert np.array_equal(result, image)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_preprocess.py -k dewarp -v
```
Expected: FAIL — `AttributeError: module 'pdfrestore.preprocess' has no attribute 'dewarp'`.

- [ ] **Step 3: Implement dewarp**

Append to `pdf-restorer/src/pdfrestore/preprocess.py`:
```python
def dewarp(image: np.ndarray, enabled: bool = False) -> np.ndarray:
    if not enabled:
        return image
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    h, w = gray.shape
    col_step = max(1, w // 40)
    sample_cols = list(range(0, w, col_step))
    baseline_rows = []
    for col in sample_cols:
        band = thresh[:, col : col + col_step]
        col_ink = band.sum(axis=1)
        if col_ink.max() <= 0:
            baseline_rows.append(None)
            continue
        baseline_rows.append(int(np.argmax(col_ink)))
    known = [(c, r) for c, r in zip(sample_cols, baseline_rows) if r is not None]
    if len(known) < 5:
        return image
    xs = np.array([c for c, _ in known])
    ys = np.array([r for _, r in known])
    coeffs = np.polyfit(xs, ys, 2)
    curve = np.polyval(coeffs, np.arange(w))
    shift = curve - np.median(curve)
    map_x, map_y = np.meshgrid(np.arange(w), np.arange(h))
    map_y = (map_y + shift[np.newaxis, :]).astype(np.float32)
    map_x = map_x.astype(np.float32)
    return cv2.remap(
        image, map_x, map_y, interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_preprocess.py -k dewarp -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add pdf-restorer/src/pdfrestore/preprocess.py pdf-restorer/tests/test_preprocess.py
git commit -m "$(cat <<'EOF'
feat(pdf-restorer): add best-effort dewarp, off by default

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 7: Page preprocessing orchestrator with per-stage fallback

**Files:**
- Modify: `pdf-restorer/src/pdfrestore/preprocess.py`
- Modify: `pdf-restorer/tests/test_preprocess.py`

**Interfaces:**
- Consumes: `deskew`, `crop_to_page`, `denoise_and_enhance`, `dewarp` (this module, Tasks 3–6).
- Produces: `preprocess.preprocess_page(image: np.ndarray, dewarp_enabled: bool = False) -> np.ndarray`.

- [ ] **Step 1: Write the failing tests**

Append to `pdf-restorer/tests/test_preprocess.py`:
```python
def test_preprocess_page_returns_valid_image(make_text_page_image):
    image = np.array(make_text_page_image("Full pipeline page"))

    result = preprocess.preprocess_page(image)

    assert result.ndim == 3
    assert result.shape[2] == 3
    assert result.dtype == np.uint8


def test_preprocess_page_falls_back_on_stage_failure(monkeypatch, make_text_page_image):
    image = np.array(make_text_page_image("Resilient page"))

    def _boom(_img):
        raise RuntimeError("boom")

    monkeypatch.setattr(preprocess, "deskew", _boom)

    result = preprocess.preprocess_page(image)

    assert result is not None
    assert result.shape[2] == 3
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_preprocess.py -k preprocess_page -v
```
Expected: FAIL — `AttributeError: module 'pdfrestore.preprocess' has no attribute 'preprocess_page'`.

- [ ] **Step 3: Implement preprocess_page**

Append to `pdf-restorer/src/pdfrestore/preprocess.py`:
```python
def preprocess_page(image: np.ndarray, dewarp_enabled: bool = False) -> np.ndarray:
    result = image
    try:
        result = crop_to_page(result)
    except Exception:
        logger.warning("crop_to_page failed, using original page", exc_info=True)
        result = image
    try:
        result = deskew(result)
    except Exception:
        logger.warning("deskew failed, continuing without deskew", exc_info=True)
    try:
        result = dewarp(result, enabled=dewarp_enabled)
    except Exception:
        logger.warning("dewarp failed, continuing without dewarp", exc_info=True)
    try:
        result = denoise_and_enhance(result)
    except Exception:
        logger.warning("denoise_and_enhance failed, continuing without it", exc_info=True)
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_preprocess.py -v
```
Expected: all `test_preprocess.py` tests pass (8 total across Tasks 3–7).

- [ ] **Step 5: Commit**

```bash
git add pdf-restorer/src/pdfrestore/preprocess.py pdf-restorer/tests/test_preprocess.py
git commit -m "$(cat <<'EOF'
feat(pdf-restorer): orchestrate page preprocessing with per-stage fallback

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 8: Assemble corrected pages into an intermediate PDF

**Files:**
- Create: `pdf-restorer/src/pdfrestore/assemble.py`
- Create: `pdf-restorer/tests/test_assemble.py`

**Interfaces:**
- Produces: `assemble.assemble_pdf(images: list[np.ndarray], output_path: str) -> None` (raises `ValueError` on an empty list).

- [ ] **Step 1: Write the failing tests**

`pdf-restorer/tests/test_assemble.py`:
```python
import numpy as np
import pytest
import fitz

from pdfrestore import assemble


def test_assemble_pdf_preserves_page_count_and_order(tmp_path, make_text_page_image):
    page1 = np.array(make_text_page_image("Page one", size=(400, 300)))
    page2 = np.array(make_text_page_image("Page two", size=(500, 350)))
    output_path = tmp_path / "assembled.pdf"

    assemble.assemble_pdf([page1, page2], str(output_path))

    doc = fitz.open(str(output_path))
    try:
        assert doc.page_count == 2
    finally:
        doc.close()


def test_assemble_pdf_rejects_empty_list(tmp_path):
    with pytest.raises(ValueError):
        assemble.assemble_pdf([], str(tmp_path / "empty.pdf"))
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_assemble.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'pdfrestore.assemble'`.

- [ ] **Step 3: Implement assemble.py**

`pdf-restorer/src/pdfrestore/assemble.py`:
```python
import io

import img2pdf
import numpy as np
from PIL import Image


def assemble_pdf(images: list[np.ndarray], output_path: str) -> None:
    if not images:
        raise ValueError("assemble_pdf requires at least one page image")
    encoded_pages = []
    for image in images:
        pil_image = Image.fromarray(image)
        buffer = io.BytesIO()
        pil_image.save(buffer, format="PNG")
        encoded_pages.append(buffer.getvalue())
    pdf_bytes = img2pdf.convert(encoded_pages)
    with open(output_path, "wb") as fh:
        fh.write(pdf_bytes)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_assemble.py -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add pdf-restorer/src/pdfrestore/assemble.py pdf-restorer/tests/test_assemble.py
git commit -m "$(cat <<'EOF'
feat(pdf-restorer): assemble corrected pages into a lossless PDF

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 9: OCR text layer and optimization

**Files:**
- Create: `pdf-restorer/src/pdfrestore/ocr.py`
- Create: `pdf-restorer/tests/test_ocr.py`

**Interfaces:**
- Produces: `ocr.ocr_and_optimize(input_pdf_path: str, output_pdf_path: str, language: str = "eng") -> None`.

- [ ] **Step 1: Write the failing test**

`pdf-restorer/tests/test_ocr.py`:
```python
import shutil

import fitz
import pytest

from pdfrestore import ocr

pytestmark = pytest.mark.skipif(
    shutil.which("tesseract") is None,
    reason="Tesseract OCR engine not installed; skipping OCR integration test",
)


def test_ocr_and_optimize_adds_extractable_text(tmp_path, make_pdf_from_image, make_text_page_image):
    image = make_text_page_image("Searchable restoration test")
    input_pdf = make_pdf_from_image(image, name="scanned.pdf")
    output_pdf = tmp_path / "ocr_output.pdf"

    ocr.ocr_and_optimize(str(input_pdf), str(output_pdf), language="eng")

    doc = fitz.open(str(output_pdf))
    try:
        text = doc[0].get_text()
    finally:
        doc.close()
    assert "restoration" in text.lower()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_ocr.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'pdfrestore.ocr'` (or SKIPPED if Tesseract isn't installed on this machine — if skipped, verify the failure by temporarily renaming the module and confirming the test would fail once dependencies are present; otherwise proceed once Tesseract is installed per README).

- [ ] **Step 3: Implement ocr.py**

`pdf-restorer/src/pdfrestore/ocr.py`:
```python
import ocrmypdf


def ocr_and_optimize(input_pdf_path: str, output_pdf_path: str, language: str = "eng") -> None:
    ocrmypdf.ocr(
        input_pdf_path,
        output_pdf_path,
        language=language,
        force_ocr=True,
        optimize=1,
        deskew=True,
        output_type="pdf",
        progress_bar=False,
    )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_ocr.py -v
```
Expected: 1 passed (or 1 skipped if Tesseract is unavailable in this environment — install it per `README.md` and re-run to confirm a real pass before moving on).

- [ ] **Step 5: Commit**

```bash
git add pdf-restorer/src/pdfrestore/ocr.py pdf-restorer/tests/test_ocr.py
git commit -m "$(cat <<'EOF'
feat(pdf-restorer): add OCR text layer + safe optimization via ocrmypdf

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 10: Pipeline orchestration (restore_pdf)

**Files:**
- Create: `pdf-restorer/src/pdfrestore/pipeline.py`
- Create: `pdf-restorer/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `rasterize.rasterize_pdf` (Task 2), `preprocess.preprocess_page` (Task 7), `assemble.assemble_pdf` (Task 8), `ocr.ocr_and_optimize` (Task 9).
- Produces: `pipeline.RestoreResult` dataclass (`output_path: str`, `page_count: int`, `warnings: list[str]`) and `pipeline.restore_pdf(input_path: str, output_path: str | None = None, dpi: int = 300, dewarp: bool = False, language: str = "eng") -> RestoreResult` (raises `FileNotFoundError` if `input_path` doesn't exist, `ValueError` if the PDF has no pages).

- [ ] **Step 1: Write the failing tests**

`pdf-restorer/tests/test_pipeline.py`:
```python
import hashlib
import shutil
from pathlib import Path

import fitz
import pytest

from pdfrestore import pipeline


def _sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@pytest.mark.skipif(
    shutil.which("tesseract") is None,
    reason="Tesseract OCR engine not installed; skipping pipeline integration test",
)
def test_restore_pdf_preserves_input_and_adds_searchable_text(
    tmp_path, make_pdf_from_image, make_text_page_image
):
    image = make_text_page_image("Integration pipeline verification", angle=-4)
    input_pdf = make_pdf_from_image(image, name="book_scan.pdf")
    original_hash = _sha256(input_pdf)

    output_path = tmp_path / "book_scan.ocr.pdf"
    result = pipeline.restore_pdf(str(input_pdf), str(output_path), dpi=200)

    assert _sha256(input_pdf) == original_hash
    assert Path(result.output_path) == output_path
    assert result.page_count == 1

    doc = fitz.open(str(output_path))
    try:
        text = doc[0].get_text().lower()
    finally:
        doc.close()
    assert "verification" in text


@pytest.mark.skipif(
    shutil.which("tesseract") is None,
    reason="Tesseract OCR engine not installed; skipping pipeline integration test",
)
def test_restore_pdf_default_output_path(tmp_path, make_pdf_from_image, make_text_page_image):
    image = make_text_page_image("Default path test")
    input_pdf = make_pdf_from_image(image, name="mybook.pdf")

    result = pipeline.restore_pdf(str(input_pdf))

    assert result.output_path == str(tmp_path / "mybook.ocr.pdf")
    assert Path(result.output_path).exists()


def test_restore_pdf_missing_input_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        pipeline.restore_pdf(str(tmp_path / "missing.pdf"))
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_pipeline.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'pdfrestore.pipeline'`.

- [ ] **Step 3: Implement pipeline.py**

`pdf-restorer/src/pdfrestore/pipeline.py`:
```python
import logging
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from pdfrestore import assemble, ocr, preprocess, rasterize

logger = logging.getLogger(__name__)


@dataclass
class RestoreResult:
    output_path: str
    page_count: int
    warnings: list[str] = field(default_factory=list)


def restore_pdf(
    input_path: str,
    output_path: str | None = None,
    dpi: int = 300,
    dewarp: bool = False,
    language: str = "eng",
) -> RestoreResult:
    input_file = Path(input_path)
    if not input_file.is_file():
        raise FileNotFoundError(f"Input PDF not found: {input_path}")
    resolved_output = Path(output_path) if output_path else input_file.with_suffix(".ocr.pdf")

    pages = rasterize.rasterize_pdf(str(input_file), dpi=dpi)
    if not pages:
        raise ValueError(f"No pages found in {input_path}")

    warnings: list[str] = []
    processed_pages = []
    for index, page in enumerate(pages):
        try:
            processed_pages.append(preprocess.preprocess_page(page, dewarp_enabled=dewarp))
        except Exception:
            logger.warning("Preprocessing failed for page %d, using raw scan", index, exc_info=True)
            warnings.append(f"page {index}: preprocessing failed, used raw scan")
            processed_pages.append(page)

    with tempfile.TemporaryDirectory() as tmp_dir:
        intermediate_path = Path(tmp_dir) / "assembled.pdf"
        assemble.assemble_pdf(processed_pages, str(intermediate_path))

        final_tmp_path = Path(tmp_dir) / "final.pdf"
        ocr.ocr_and_optimize(str(intermediate_path), str(final_tmp_path), language=language)

        resolved_output.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(final_tmp_path), str(resolved_output))

    return RestoreResult(
        output_path=str(resolved_output),
        page_count=len(processed_pages),
        warnings=warnings,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_pipeline.py -v
```
Expected: 3 passed (or 2 skipped + 1 passed if Tesseract is unavailable — install it per `README.md` and re-run to confirm real passes before moving on).

- [ ] **Step 5: Commit**

```bash
git add pdf-restorer/src/pdfrestore/pipeline.py pdf-restorer/tests/test_pipeline.py
git commit -m "$(cat <<'EOF'
feat(pdf-restorer): orchestrate full restore_pdf pipeline

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 11: CLI

**Files:**
- Create: `pdf-restorer/src/pdfrestore/cli.py`
- Create: `pdf-restorer/src/pdfrestore/__main__.py`
- Create: `pdf-restorer/tests/test_cli.py`

**Interfaces:**
- Consumes: `pipeline.restore_pdf`, `pipeline.RestoreResult` (Task 10).
- Produces: `cli.main(argv: list[str] | None = None) -> int`, `cli._check_dependencies() -> list[str]`, `cli.REQUIRED_BINARIES: list[str]`.

- [ ] **Step 1: Write the failing tests**

`pdf-restorer/tests/test_cli.py`:
```python
from pdfrestore import cli
from pdfrestore.pipeline import RestoreResult


def test_check_dependencies_reports_missing_binaries(monkeypatch):
    monkeypatch.setattr(cli.shutil, "which", lambda name: None)

    assert cli._check_dependencies() == cli.REQUIRED_BINARIES


def test_main_missing_dependencies_exits_2(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(cli, "_check_dependencies", lambda: ["tesseract"])

    exit_code = cli.main([str(tmp_path / "in.pdf")])

    assert exit_code == 2
    assert "tesseract" in capsys.readouterr().err


def test_main_single_file_success(monkeypatch, tmp_path, capsys):
    input_pdf = tmp_path / "book.pdf"
    input_pdf.write_bytes(b"%PDF-1.4 fake")
    monkeypatch.setattr(cli, "_check_dependencies", lambda: [])
    monkeypatch.setattr(
        cli,
        "restore_pdf",
        lambda *a, **k: RestoreResult(
            output_path=str(tmp_path / "book.ocr.pdf"), page_count=1, warnings=[]
        ),
    )

    exit_code = cli.main([str(input_pdf)])

    assert exit_code == 0
    assert "OK" in capsys.readouterr().out


def test_main_batch_mode_reports_summary_and_nonzero_on_failure(monkeypatch, tmp_path, capsys):
    (tmp_path / "a.pdf").write_bytes(b"%PDF-1.4 fake")
    (tmp_path / "b.pdf").write_bytes(b"%PDF-1.4 fake")
    monkeypatch.setattr(cli, "_check_dependencies", lambda: [])

    def fake_restore(input_path, output_path=None, **kwargs):
        if "a.pdf" in input_path:
            return RestoreResult(output_path=output_path, page_count=1, warnings=[])
        raise RuntimeError("boom")

    monkeypatch.setattr(cli, "restore_pdf", fake_restore)

    exit_code = cli.main(["--batch", str(tmp_path)])
    out = capsys.readouterr().out

    assert exit_code == 1
    assert "OK" in out
    assert "FAIL" in out
    assert "1/2 succeeded" in out
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cli.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'pdfrestore.cli'`.

- [ ] **Step 3: Implement cli.py and __main__.py**

`pdf-restorer/src/pdfrestore/cli.py`:
```python
import argparse
import shutil
import sys
from pathlib import Path

from pdfrestore.pipeline import restore_pdf

REQUIRED_BINARIES = ["tesseract", "qpdf"]


def _check_dependencies() -> list[str]:
    return [name for name in REQUIRED_BINARIES if shutil.which(name) is None]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pdfrestore",
        description="Turn a scanned/photographed PDF book into a searchable, high-quality PDF.",
    )
    parser.add_argument("input", help="Input PDF file, or directory when --batch is used")
    parser.add_argument("-o", "--output", help="Output PDF file, or directory when --batch is used")
    parser.add_argument("--dpi", type=int, default=300, help="Rasterization DPI (default: 300)")
    parser.add_argument("--dewarp", action="store_true", help="Enable best-effort page-curvature dewarping")
    parser.add_argument("--lang", default="eng", help="Tesseract OCR language code (default: eng)")
    parser.add_argument("--batch", action="store_true", help="Treat input/output as directories")
    return parser


def _run_single(input_path: Path, output_path: Path | None, args: argparse.Namespace) -> tuple[bool, str]:
    try:
        result = restore_pdf(
            str(input_path),
            str(output_path) if output_path else None,
            dpi=args.dpi,
            dewarp=args.dewarp,
            language=args.lang,
        )
        message = f"OK   {input_path} -> {result.output_path}"
        if result.warnings:
            message += f" ({len(result.warnings)} page warning(s))"
        return True, message
    except Exception as exc:
        return False, f"FAIL {input_path}: {exc}"


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    missing = _check_dependencies()
    if missing:
        joined = ", ".join(missing)
        print(
            f"Missing required system dependencies: {joined}. "
            "Install Tesseract OCR and qpdf, then try again (see README.md).",
            file=sys.stderr,
        )
        return 2

    input_path = Path(args.input)

    if args.batch:
        if not input_path.is_dir():
            print(f"--batch requires a directory, got: {input_path}", file=sys.stderr)
            return 2
        output_dir = Path(args.output) if args.output else input_path
        output_dir.mkdir(parents=True, exist_ok=True)
        pdf_files = sorted(input_path.glob("*.pdf"))
        if not pdf_files:
            print(f"No PDF files found in {input_path}", file=sys.stderr)
            return 1
        results = []
        for pdf_file in pdf_files:
            out_file = output_dir / f"{pdf_file.stem}.ocr.pdf"
            results.append(_run_single(pdf_file, out_file, args))
        for _, message in results:
            print(message)
        failures = sum(1 for ok, _ in results if not ok)
        print(f"{len(results) - failures}/{len(results)} succeeded")
        return 1 if failures else 0

    output_path = Path(args.output) if args.output else None
    ok, message = _run_single(input_path, output_path, args)
    print(message)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
```

`pdf-restorer/src/pdfrestore/__main__.py`:
```python
import sys

from pdfrestore.cli import main

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cli.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Run the full test suite and commit**

```bash
pytest -v
```
Expected: all tests across `test_rasterize.py`, `test_preprocess.py`, `test_assemble.py`, `test_ocr.py`, `test_pipeline.py`, `test_cli.py` pass (OCR/pipeline tests pass for real if Tesseract + qpdf are installed, otherwise report as skipped).

```bash
git add pdf-restorer/src/pdfrestore/cli.py pdf-restorer/src/pdfrestore/__main__.py pdf-restorer/tests/test_cli.py
git commit -m "$(cat <<'EOF'
feat(pdf-restorer): add CLI with single-file and batch modes

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```
