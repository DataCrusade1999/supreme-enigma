---
paths:
  - lambda/**
---

# `lambda/` — Python 3.12 DSP pipeline

Test command lives in the root `CLAUDE.md`. This file is the per-file detail.

- **Python deps live in a local venv at `lambda/.venv`, not the global interpreter.** Create and populate it with:
  ```bash
  py -3.13 -m venv lambda/.venv                  # Windows; `python3.13 -m venv` elsewhere
  lambda/.venv/Scripts/python -m pip install --require-hashes -r lambda/requirements-dev.txt
  ```
  `.venv/` is already gitignored at the repo root, so it's covered at any depth. Re-run the `pip install` after any Dependabot bump to `lambda/requirements.txt` lands — the venv doesn't update itself, and a stale venv passes tests against versions the deployed image no longer uses.
- **`requirements.txt` and `requirements-dev.txt` are generated lock files with hashes (#551); edit the `.in` files.** `requirements.in` holds the runtime ranges (what the image installs), `requirements-dev.in` adds `pytest` and `moto` for CI and local tests, constrained to the runtime lock. They are pip-tools output, the format Dependabot's pip updater regenerates, and its header records Python 3.12, which Dependabot reads to pick its interpreter. Python 3.12 isn't installed here, so run pip-tools through `uv`'s managed 3.12, runtime first: `cd lambda && uvx --python 3.12 --from pip-tools pip-compile --generate-hashes --allow-unsafe --strip-extras -o requirements.txt requirements.in`, then the same for `requirements-dev`. pip-tools resolves for the platform it runs on, so a Windows run pins `colorama` (pytest's Windows-only dependency) without a marker; it is harmless on Linux. Each pin carries the hashes of every wheel of that version, so one lock installs on Linux 3.12 and Windows 3.13 alike. The Dockerfile and CI install with `--require-hashes`, so a hand edit to a `.txt` file without its hashes fails the install.
- **Local venv Python is 3.13, but the Lambda runtime and CI are 3.12** (3.12 isn't installed on this machine; 3.13 and 3.11 are). It was 3.11 until 2026-09-05 — librosa 1.0 declares `Requires-Python >=3.12`, so a 3.11 venv can no longer install `requirements.txt` at all — pip aborts the whole install with a non-zero exit and leaves every package at its old version. 3.13 is now the only viable local interpreter. Still not an exact runtime match — CI on 3.12 is the authority, not a local green run.
- **`lambda/tests/conftest.py` sets dummy AWS creds at module import time**, not in a fixture — `handler.py` builds its boto3 client at module scope, so a fixture would set the env var too late.
- **`NUMBA_CACHE_DIR=/tmp/numba_cache`** is set in the Dockerfile — librosa's numba JIT cache otherwise tries to write to Lambda's read-only filesystem.
- Merge `lambda/`-touching PRs one at a time; two `deploy` jobs racing on the same function fail with `ResourceConflictException`. See "Merging a PR" in the root `CLAUDE.md`.
