# CI: one cross-OS E2E summary, Trivy findings from JSON, scan artifacts — design

**Date:** 2026-09-18
**Status:** approved in chat, not yet implemented
**Issue:** #218
**Plan:** `docs/superpowers/plans/2026-09-18-ci-summary-polish.md`
**Supersedes parts of:** `docs/superpowers/specs/2026-09-18-ci-matrix-security-summary-design.md` (§4 output format, §7 emoji limit)

## 1. What changes

The four job summaries added in #212 report the right facts and are awkward to
read. This design keeps every gating decision exactly as it is and changes only
how results are rendered and what is kept after the run:

1. The three `e2e` matrix legs stop writing one summary each. They upload their
   results JSON instead, and the existing `summary` job renders **one table with
   an OS column each** (§2).
2. Trivy switches from `format: table` to `format: json`, and the summary is
   rendered from the structure rather than scraped from ASCII (§3).
3. Both the Trivy JSON and its rendered markdown become **downloadable
   artifacts** (§3).
4. Presentation work across all four summaries: counts as tables, durations,
   source links, failures grouped by file, ANSI stripped (§4).
5. `.github/scripts/` gains a shared `summary-lib.mjs` and is renamed into a
   consistent set (§5).

Nothing in `deploy`, `release`, `changes`, `promotion-guard` or any `if:` chain
changes. `summary` still gates nothing.

## 2. One E2E table across the matrix

### Why it needs artifacts

`$GITHUB_STEP_SUMMARY` is per job, and a matrix leg *is* a job. There is no
expression, no `needs` output and no merge setting that puts three legs' markdown
in one place. The only mechanism GitHub offers is an artifact written by each leg
and read by a downstream job.

### Where it renders

In the **existing `summary` job**, not a new one. It already carries
`needs: [unit, lambda, e2e, security, chromatic]` and `if: always()`, which is
exactly the trigger condition a combined table needs. A dedicated `e2e-summary`
job would be a fourth billed row against the 2,000-minute free-plan budget that
shaped the whole matrix design, for a job that does nothing but read JSON.

### Upload

```yaml
- name: Upload Playwright results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-results-${{ runner.os }}
    path: web/playwright-results.json
    retention-days: 7
    overwrite: true
    if-no-files-found: warn
```

Four of those five settings are load-bearing:

- **`if: always()`** — a leg that fails is the leg whose results matter most. The
  default would skip the upload on exactly the run worth reading.
- **`runner.os`** in the name — artifact names must be unique within a run under
  `upload-artifact@v4`, and `runner.os` yields `Linux` / `Windows` / `macOS`,
  which are the column headers, so no second mapping table is needed.
- **`overwrite: true`** — v4 artifacts are immutable. `gh run rerun --failed` is
  this repo's documented recovery path (CLAUDE.md, the stale-Lambda runbook), and
  a rerun re-uploads the same name. Without this it fails on the first retry,
  which is the worst possible time for a new failure mode.
- **`if-no-files-found: warn`** — a leg that crashes before Playwright writes its
  reporter output has no file. That should show up as a gap in the table, not as
  a second red step obscuring the first one.

`actions/upload-artifact` and `actions/download-artifact` are first-party
`actions/*`, so this does not break the repo's preference for hand-rolled
scripting over marketplace actions (the `changes` job's plain `git diff`).

### Download

```yaml
- name: Download Playwright results
  uses: actions/download-artifact@v4
  continue-on-error: true
  with:
    pattern: playwright-results-*
    path: e2e-results
```

`merge-multiple` is deliberately **not** set. All three artifacts contain a file
named `playwright-results.json`; merging them into one directory would have the
legs overwrite each other and silently report one OS three times. Left unset,
each lands in `e2e-results/playwright-results-<OS>/`, and the directory name is
where the OS label comes from.

`continue-on-error: true` because `summary` is a reporting job that gates
nothing: if the download fails, or `e2e` was cancelled before any leg uploaded,
the right outcome is a summary that says so, not a red job.

### Table

```markdown
## E2E + accessibility tests (Playwright)

**126 passed**, 0 failed, 0 flaky, 3 skipped across 3 runners.

| Spec | 🐧 Linux | 🪟 Windows | 🍎 macOS |
|---|---|---|---|
| [`web/e2e/a11y.spec.ts`](…) | ✅ 8 | ✅ 8 | ✅ 8 |
| [`web/e2e/pages.spec.ts`](…) | ✅ 6 | ❌ 1/6 | ✅ 6 |
| **Total** | **✅ 42** | **❌ 1/42** | **✅ 42** |
| **Duration** | 1m 47s | 7m 03s | 1m 15s |
```

Cell vocabulary: `✅ N` all expected, `❌ a/b` a failed of b, `⚠️ a/b` a flaky of
b, `⏭️ N` all skipped, `–` the spec did not run on that OS. A column appears only
if its artifact does; on an ordinary PR there is one leg and the table is one
column wide, which is the honest rendering of what ran.

The **duration row** is the point of doing this at all. Minutes are the binding
constraint on this repo's CI (the previous spec's §2 is entirely about the
2,000-minute budget), and until now no summary reported a single one. The
measured figures the matrix was sized against — Linux 1m47s, Windows 7m03s,
macOS 1m15s — had to be dug out of a run's timing panel by hand.

Failures render below the table as `<details>` blocks grouped OS → spec, and a
collapsed "slowest 5 tests" table lists the five slowest across all runners with
their OS.

### Parsing

Counts come from the report's top-level `stats` object
(`{ startTime, duration, expected, unexpected, skipped, flaky }`), verified
against a real report from `@playwright/test` as installed. Per-spec cells walk
the suite tree and read **`tests[].status`** (`expected` | `unexpected` |
`skipped` | `flaky`), not `tests[].results[]`.

That is a correctness fix, not a style change. The current walker counts every
entry in `results[]` as a separate test, so a retried test inflates the total and
a retried-then-passed test is reported as one failure and one pass. It is latent
today because `playwright.config.ts` sets no `retries`, but the rewrite gets it
right for free and `status` carries `flaky` as a first-class value, which
`results[]` cannot express at all.

`spec.file` is relative to `config.rootDir`, and **Playwright sets `rootDir` to
the project's `testDir`** — `web/e2e` here — not to the directory holding
`playwright.config.ts`. The first implementation assumed the config directory,
which produced `web/a11y.spec.ts` for a file that lives at
`web/e2e/a11y.spec.ts`: every row's link 404'd. Caught by reading the artifact
from this change's own PR run rather than by any test, because the fixtures
encoded the same wrong assumption.

The prefix is therefore derived per leg from that leg's own `config.rootDir`
(`/home/runner/work/supreme-enigma/supreme-enigma/web/e2e` on Linux,
`D:\\a\\supreme-enigma\\supreme-enigma\\web\\e2e` on Windows). A runner's
checkout root is always `<…>/<repo>/<repo>`, so the last `/<repo>/` in the
normalised path ends the prefix on any OS — which matters because the `summary`
job's own `GITHUB_WORKSPACE` belongs to a different runner and is no help for
the Windows and macOS legs. Off a runner there is no such marker and a
documented `web/e2e` fallback stands in; the test suite covers both paths, plus
a `testDir` moved one level deeper.

## 3. Security scan: JSON in, markdown out, both kept

### The regex goes away

`security-summary.mjs` currently counts findings with
`/^(?:Total|Failures): (\d+) \(/gm` over Trivy's ASCII table. The previous spec
(§4) already documents why that is uncomfortable: the count line reads `Total:`
for vulnerabilities and secrets but `Failures:` for misconfiguration, and current
Trivy versions print no count line at all for a clean target. Every one of those
is a formatting decision inside Trivy that can change in a patch release, and
when it does the summary reports "no findings" on a run that had them.

`format: json` carries the same findings structurally, and carries three things
the table throws away: `PrimaryURL` (the advisory link), `CauseMetadata.StartLine`
(where a misconfiguration actually is) and per-finding `Severity` for sorting.

The action writes one `output:` per invocation, so this is json-or-table, not
both. Running Trivy twice to get both formats would double the scan and the DB
download for a rendering convenience.

### Rendering

Three sections, each omitted when empty, severity-sorted CRITICAL before HIGH:

| Section | Columns |
|---|---|
| Vulnerabilities | Severity, Package, Installed, Fixed in, Advisory (linked `PrimaryURL`) |
| Misconfiguration | Severity, Check (linked), Where (linked to file#L at the head SHA), Message |
| Secrets | Severity, Rule, Where (linked to file#L) |

**The `Match` field is never printed**, in the summary or in the rendered
markdown artifact. Trivy redacts the secret itself, but the surrounding line is
still the context of a credential and there is no reason to copy it into a
summary that is quoted into PR comments and chat. File and line locate it well
enough for whoever has to fix it.

### Three states, unchanged

The existing three-state logic is preserved, because the reasoning behind it
still holds — in particular that a DB-download failure must read differently from
a clean scan. Only the discriminator changes, from regex hits to parse result:

| State | Condition | Renders |
|---|---|---|
| Findings | JSON parses, `Results[]` contains at least one finding | The tables above |
| Clean | JSON parses, no findings, outcome `success` | "No HIGH or CRITICAL findings with a fix available." |
| Scanner failed | JSON missing or unparseable, or outcome not `success` with no findings | "⚠️ The scanner did not complete… rerun the job" |

Findings are still decided from the file, never from the step outcome, so
flipping back to `exit-code: "0"` for a triage run still reports honestly.

**Correction (2026-09-18, issue #222).** An earlier revision of this section
said a clean run must not list the scanned targets, "because Trivy's JSON omits
findings-free targets, so any such list would be a lie by omission." That is
false, and it was written without being checked against real Trivy output. A
clean report from Trivy 0.70.0 carries all seven targets:

| Target | Class | Type | Carries |
|---|---|---|---|
| `web/package-lock.json` | lang-pkgs | npm | `Packages` — 366 entries |
| `infra/bootstrap` | config | terraform | `MisconfSummary {Successes: 23, Failures: 0}` |
| `infra/bootstrap/main.tf` | config | terraform | nothing |
| `infra/main` | config | terraform | `MisconfSummary {Successes: 28, Failures: 0}` |
| `infra/main/environments.tf` | config | terraform | nothing |
| `infra/main/shared.tf` | config | terraform | nothing |
| `lambda/Dockerfile` | config | dockerfile | `MisconfSummary {Successes: 19, Failures: 0}` |

Trivy emits a per-directory aggregate that holds the tally *and* a per-file
result that holds nothing, so a target with no counts of its own is normal, not
a gap.

Every run therefore renders a **Coverage** table — target, type, what was
scanned (`366 packages` / `28 checks` / `—`) and that target's finding count —
under the finding tables when there are findings, and on its own when there are
not. A footer gives `Trivy <version> · N targets · commit <sha>` from the
report.

The reason is not decoration. "No findings" does not distinguish a scan that
passed from a scan that covered nothing, and a scanner pointed at the wrong ref
reports the second as the first. The 70 passing misconfiguration checks are the
evidence that separates them. A report with *no* targets is the one case where
a clean result is not reassuring, and it says so explicitly.

### Artifacts

```yaml
- name: Upload scan results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: trivy-results
    path: |
      trivy-results.json
      trivy-summary.md
    retention-days: 30
    overwrite: true
    if-no-files-found: warn
```

The JSON is the machine-readable record; `trivy-summary.md` is the same markdown
the job summary gets, written to a file by the same script in the same pass, so
the two cannot disagree. 30 days rather than the 7 used for test results: a scan
result is the thing someone asks about weeks later ("when did this CVE first
appear?"), and the files are kilobytes.

## 4. Presentation

Applies to every summary:

- **Counts as a table row**, not bold prose. `**213 passed**, **0 failed**, 2
  skipped, 215 total` becomes a five-column table with emoji headers and a
  duration column.
- **Durations.** Vitest per-assertion `duration` summed per file; Playwright
  `stats.duration` per leg. Each test summary gets a collapsed **slowest 5**
  table — the direct answer to "which spec is eating the Windows leg's seven
  minutes".
- **Source links.** Failure headings link to the file (and line, where the
  reporter gives one) at the commit under test. Playwright gives `spec.line`, so
  its links are line-anchored. Vitest's JSON reporter emits `location` only when
  `includeTaskLocation` is enabled, which `vitest.config.ts` does not set —
  verified against a real 340-test report, where 340 assertions carried
  `duration` and 0 carried `location` — so its links are file-level. Turning that
  option on is a `vitest.config.ts` change, which §6 puts out of scope. The SHA
  passed in is
  `github.event.pull_request.head.sha || github.sha`: on a `pull_request` event
  `github.sha` is the synthetic merge commit, whose blob URLs are not browsable
  from the PR. Links are omitted entirely when `GITHUB_SERVER_URL`,
  `GITHUB_REPOSITORY` or the SHA is absent, so local runs still render.
- **Failures grouped by file** rather than a flat list.
- **ANSI stripped.** Playwright's `result.error.message` contains terminal escape
  codes — `expect([31mreceived[39m)` — which today are pasted raw into
  the summary and render as literal `[31m` noise. Confirmed present in a real
  report, not theoretical.
- **Raw output stays collapsed.** Job summaries are capped at 1 MiB per step;
  everything bulky goes in `<details>`.

This deliberately relaxes the previous plan's constraint that emoji be limited to
the rollup table's status column. Status cells, severity markers and the three OS
column headers use them; prose does not.

## 5. Script layout

| Before | After | Why |
|---|---|---|
| `test-summary.mjs --kind vitest\|playwright [--label]` | `unit-summary.mjs <file>` | The playwright path moves out, leaving a `--kind` flag with one legal value. The rename also retires a footgun the previous plan had to warn about: `node --test` over a bare directory picks up `test-summary.mjs` itself as a test file, because it matches `test-*.mjs`. |
| — | `e2e-summary.mjs <download-dir>` | New: the combined matrix renderer. |
| `security-summary.mjs <table> <outcome>` | `security-summary.mjs <json> <outcome>` | Same arity, JSON input, also writes `trivy-summary.md`. |
| `run-summary.mjs` | unchanged behaviour | Icons now come from the shared lib. The `Cross-OS e2e: yes/no` footer stays: the E2E table's columns usually make it redundant, but not when `e2e` was cancelled before any leg uploaded, which is precisely when someone needs to know what should have run. |
| — | `summary-lib.mjs` | Shared by all four: `fence()`, `stripAnsi()`, `ICONS`, `blobLink()`, `formatDuration()`, `emit()`. `fence()` and the `GITHUB_STEP_SUMMARY` write are already duplicated across two scripts today; this change would make it four. |

Every script keeps its `*.test.mjs`, run by the `unit` job's
`node --test ".github/scripts/*.test.mjs"` step. `security-summary.test.mjs`'s
fixtures are table-format and are replaced wholesale.

## 6. Out of scope

- **Playwright HTML reports as artifacts.** The traces and screenshots are the
  genuinely useful download for a failing e2e run, but they are tens of MB per
  leg and need their own retention and `if: failure()` decision. Parked in the
  previous spec's §10 and still parked; asked about in chat and deferred.
- SARIF upload to the Security tab — still paywalled here.
- Caching Trivy's DB, `npm ci`, cross-OS Lambda tests, changes to
  `playwright.config.ts` or `vitest.config.ts`.
- Any change to what gates `deploy` or `release`.
