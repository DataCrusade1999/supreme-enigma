# CI: one cross-OS E2E summary, Trivy findings from JSON, scan artifacts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the four CI job summaries so a run reads at a glance — one E2E table with an OS column per matrix leg instead of three separate summaries, Trivy findings rendered from JSON instead of scraped from ASCII, and downloadable artifacts for both — without changing a single gating decision.

**Architecture:** Each `e2e` matrix leg uploads `web/playwright-results.json` as `playwright-results-<OS>`; the existing `summary` job downloads all of them and renders one table. Trivy switches to `format: json` and `security-summary.mjs` renders markdown from the structure, writing the same markdown to `trivy-summary.md` for upload alongside the JSON. `.github/scripts/` gains `summary-lib.mjs` (shared fence/ANSI/link/duration/emit helpers) and `e2e-summary.mjs`; `test-summary.mjs` becomes `unit-summary.mjs` and loses its playwright and `--label` paths.

**Tech Stack:** GitHub Actions, `actions/upload-artifact@v4`, `actions/download-artifact@v4`, `aquasecurity/trivy-action@v0.36.0`, Node 22 `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-09-18-ci-summary-polish-design.md`

**Issue:** #218 — the implementation PR closes it with `Closes #218`.

**Branch:** `feat/ci-summary-polish`, cut fresh from `dev`.

## Global Constraints

- All commands run from the repo root `E:\Personal\looper` unless stated otherwise. Shell is Git Bash.
- **No `if:` on `deploy`, `release`, `changes` or `promotion-guard` changes.** This is a rendering change. If a diff touches a gating condition, it is wrong.
- **`summary` stays out of every `needs:` list.** It reports; it does not gate.
- **`summary` must stay green when there is nothing to render.** `e2e` cancelled, no artifacts, a failed download — all produce a summary that says so, never a red job. That is what `continue-on-error: true` on the download step is for.
- Node scripts under `.github/scripts/` are ESM (`.mjs`), tested by `node --test ".github/scripts/*.test.mjs"` (quoted glob), and must run on Node 22 with no dependencies.
- **Never print Trivy's `Match` field** for a secret finding, in the step summary or in `trivy-summary.md`. File and line only.
- **Every script must render without any `GITHUB_*` env var set.** The `*.test.mjs` suites run locally with `GITHUB_STEP_SUMMARY: ""`; a script that assumes `GITHUB_REPOSITORY` exists breaks them.
- Pin actions to the tags named here: `actions/upload-artifact@v4`, `actions/download-artifact@v4`. The rest of the file keeps what it has.
- `CHANGELOG.md` gets its entry under `## [Unreleased]` on this branch.
- Every commit message ends with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.
- Validate `deploy.yml` after every edit: `lambda/.venv/Scripts/python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml')); print('ok')"`.
- Do not touch `infra/`, `playwright.config.ts`, `vitest.config.ts`, `web/` source, or `.github/workflows/release-tests.yml`.

## File map

| File | Change | Responsibility |
|---|---|---|
| `.github/scripts/summary-lib.mjs` | Create | `fence`, `stripAnsi`, `ICONS`, `blobLink`, `formatDuration`, `emit` |
| `.github/scripts/summary-lib.test.mjs` | Create | Unit tests for the above |
| `.github/scripts/unit-summary.mjs` | Rename from `test-summary.mjs` + rewrite | Vitest summary: count table, slowest 5, grouped failures, file links |
| `.github/scripts/unit-summary.test.mjs` | Rename from `test-summary.test.mjs` + rewrite | Drops the `--label` and playwright cases |
| `.github/scripts/e2e-summary.mjs` | Create | Combined per-OS Playwright table from a download directory |
| `.github/scripts/e2e-summary.test.mjs` | Create | One leg, three legs, missing leg, no artifacts, malformed JSON |
| `.github/scripts/security-summary.mjs` | Rewrite | Trivy JSON → three finding tables + `trivy-summary.md` |
| `.github/scripts/security-summary.test.mjs` | Rewrite | Fixtures become JSON |
| `.github/scripts/run-summary.mjs` | Modify | Import `ICONS`/`emit` from the lib; behaviour unchanged |
| `.github/workflows/deploy.yml` | Modify | Upload/download steps, Trivy `format: json`, script renames |
| `CHANGELOG.md` | Modify | `[Unreleased]` entry |

## Task 1 — `summary-lib.mjs` and its tests

- [ ] Create `.github/scripts/summary-lib.mjs` exporting:
  - `fence(body)` — moved verbatim from `test-summary.mjs`, including its comment about a failure message that itself contains a ``` block.
  - `stripAnsi(s)` — removes CSI sequences. Playwright's `result.error.message` carries them; confirmed in a real report.
  - `ICONS` — `{ success: "✅", failure: "❌", skipped: "⏭️", cancelled: "🚫", flaky: "⚠️" }`.
  - `blobLink(path, line)` — returns a markdown link to `GITHUB_SERVER_URL/GITHUB_REPOSITORY/blob/<sha>/<path>[#L<line>]`, where `<sha>` is `process.env.HEAD_SHA`. Returns plain `` `path` `` when any of the three is missing.
  - `formatDuration(ms)` — `1m 47s` / `12.4s` / `840ms`.
  - `emit(lines)` — join, append to `GITHUB_STEP_SUMMARY` when set and non-empty, else `console.log`.
- [ ] Create `.github/scripts/summary-lib.test.mjs`. Cover: `fence` escalates past a 4-backtick run; `stripAnsi` on a real Playwright message; `blobLink` with and without env; `formatDuration` at each boundary.
- [ ] **Verify:** `node --test ".github/scripts/summary-lib.test.mjs"` passes.

## Task 2 — `unit-summary.mjs`

- [ ] `git mv .github/scripts/test-summary.mjs .github/scripts/unit-summary.mjs` and the same for the test file.
- [ ] Rewrite to signature `unit-summary.mjs <results-file>`. Remove `--kind`, `--label` and every playwright code path.
- [ ] Render: heading, a counts table (`✅ Passed | ❌ Failed | ⏭️ Skipped | Total | Duration`), a collapsed slowest-5 table, then failures grouped by file with a `blobLink` heading per file.
  - Duration: `max(testResults[].endTime) - data.startTime`, falling back to the sum of assertion durations when `endTime` is absent.
  - `testResults[].name` is an absolute runner path; strip a normalized `GITHUB_WORKSPACE` prefix to get the repo-relative path. Fall back to the basename when it does not match.
  - Vitest emits no `location`, so links are file-level. Do not invent line anchors.
- [ ] Keep both degrade-to-warning paths (missing file, unparseable/wrong-shape file) exactly as they are — same wording, same `if: always()` safety.
- [ ] Rewrite `unit-summary.test.mjs`: counts table, duration, slowest-5 present, failure block with a file link, missing file, malformed JSON, wrong-shape JSON, usage error.
- [ ] **Verify:** `node .github/scripts/unit-summary.mjs <a real vitest json>` renders, and `node --test ".github/scripts/unit-summary.test.mjs"` passes.

## Task 3 — `e2e-summary.mjs`

- [ ] Create `.github/scripts/e2e-summary.mjs` with signature `e2e-summary.mjs <download-dir>`.
- [ ] Discover legs: each immediate subdirectory named `playwright-results-<OS>` containing `playwright-results.json`. OS label is the suffix. Order the columns Linux, Windows, macOS, then anything else alphabetically.
- [ ] Per leg, read top-level `stats` for counts and duration. Walk `suites[]` recursively for per-spec cells, reading `tests[].status` (`expected`/`unexpected`/`skipped`/`flaky`) — **not** `tests[].results[]`.
- [ ] Render: heading, one-line totals across runners, the spec × OS table with `Total` and `Duration` rows, failures grouped OS → spec as `<details>` with ANSI-stripped messages, and a collapsed slowest-5 across all runners.
  - Cells: `✅ N`, `❌ a/b`, `⚠️ a/b` (flaky), `⏭️ N`, `–` for a spec that did not run on that OS.
  - Spec paths are `web/` + `spec.file`; the prefix is a documented constant (see spec §2).
- [ ] Handle: no directory at all, directory with no matching subdirectories, a leg whose JSON is missing or unparseable (that column reads `⚠️`, a note says which leg and why, the others still render).
- [ ] Create `e2e-summary.test.mjs` covering each of those, plus a three-leg run where one spec fails on Windows only.
- [ ] **Verify:** `node --test ".github/scripts/e2e-summary.test.mjs"` passes.

## Task 4 — `security-summary.mjs`

- [ ] Rewrite for signature `security-summary.mjs <trivy-results.json> <outcome>`.
- [ ] Parse `Results[]`; collect `Vulnerabilities`, `Misconfigurations`, `Secrets`. Sort CRITICAL before HIGH, then by target.
- [ ] Render the three tables from spec §3, each omitted when empty. Link `PrimaryURL`; link misconfig and secret locations with `blobLink(target, CauseMetadata?.StartLine ?? StartLine)`.
- [ ] **Do not emit `Match`.**
- [ ] Preserve the three states and their wording (findings / clean / scanner did not complete), with the discriminator now being parse success plus finding count, never the regex.
- [ ] Write the same markdown to `trivy-summary.md` in the working directory as well as to the step summary.
- [ ] Rewrite `security-summary.test.mjs` with JSON fixtures: vulnerabilities only, misconfig only, secrets only (asserting the `Match` value never appears in stdout), mixed, clean-with-empty-Results, clean-with-absent-Results, unparseable JSON + `failure`, missing file + `failure`, findings present while outcome is `success` (report-only mode).
- [ ] **Verify:** `node --test ".github/scripts/security-summary.test.mjs"` passes.

## Task 5 — `run-summary.mjs`

- [ ] Import `ICONS` and `emit` from `summary-lib.mjs`; delete the local copies.
- [ ] Change nothing else. The `Cross-OS e2e:` footer stays (spec §5).
- [ ] **Verify:** `node --test ".github/scripts/run-summary.test.mjs"` passes unchanged.

## Task 6 — `deploy.yml`

- [ ] `unit` job: point the summary step at `unit-summary.mjs` with the new single-argument signature, and add `env: HEAD_SHA: ${{ github.event.pull_request.head.sha || github.sha }}`.
- [ ] `e2e` job: delete the `Playwright job summary` step; add the `Upload Playwright results` step from spec §2 immediately after `Run e2e + a11y tests` and before the fail step.
- [ ] `security` job: Trivy `format: json`, `output: trivy-results.json`; summary step passes the JSON, with `HEAD_SHA` in `env`; add the `Upload scan results` step from spec §3.
- [ ] `summary` job: add the `Download Playwright results` step (with `continue-on-error: true`), then a step running `e2e-summary.mjs e2e-results` with `HEAD_SHA` in `env`, after the existing run-summary step.
- [ ] **Verify:** the YAML parses; `grep` confirms no `if:` line in `deploy`, `release`, `changes` or `promotion-guard` changed (`git diff` on those ranges is empty).

## Task 7 — Full local verification

- [ ] `node --test ".github/scripts/*.test.mjs"` — all suites pass.
- [ ] `cd web && npm run lint` — clean.
- [ ] `cd web && npm test` — passes (the scripts are not in its scope, but the job that runs them must stay green).
- [ ] Render each summary against a real fixture and read the markdown by eye. Do not ship a table that was only ever asserted with a regex.

## Task 8 — Ship

- [ ] `CHANGELOG.md` entry under `## [Unreleased]`.
- [ ] Commit, push, open the PR into `dev` with `Closes #218`.
- [ ] Follow CLAUDE.md's "Merging a PR" sequence: all four CI jobs green, the release-readiness verdict `change approved`, both reviewers' inline comments read via `gh api --paginate .../pulls/<N>/comments`, findings triaged by severity, threads replied to and resolved, then `gh pr merge <N> --squash --delete-branch`.
- [ ] **The real verification is a `workflow_dispatch` run**, which is the only trigger that exercises all three matrix legs outside a promotion PR. Read the rendered summaries there before considering the issue done.
