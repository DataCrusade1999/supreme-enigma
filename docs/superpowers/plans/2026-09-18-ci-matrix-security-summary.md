# CI: split jobs, cross-OS e2e, security scan, run summary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `deploy.yml`'s single `test` job with `unit`, `lambda`, `e2e` (OS matrix), `security` (Trivy, free) and a `summary` rollup that writes one status table, without exceeding the 2,000 free Actions minutes a month.

**Architecture:** Four independent jobs run in parallel and gate `deploy`/`release` exactly as `test` did. The `e2e` matrix is an expression that adds `windows-latest` and `macos-latest` only on promotion PRs and `workflow_dispatch`. Three small Node scripts under `.github/scripts/` render job summaries and are unit-tested with `node:test`. Trivy ships report-only, is triaged on one dispatched run, then becomes a gate.

**Tech Stack:** GitHub Actions expressions, `aquasecurity/trivy-action@v0.36.0`, `actions/setup-node@v7` cache, Node 22 `node:test`, existing `.github/scripts/test-summary.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-18-ci-matrix-security-summary-design.md`

**Issue:** #212 — the implementation PR closes it with `Closes #212`. The spec and this plan reached `dev` through their own docs-only PR (`Refs #212`), so the issue stays open until the code lands.

**Branch:** `feat/ci-matrix-security-summary`, cut fresh from `dev`: `git checkout dev && git pull --ff-only origin dev && git checkout -b feat/ci-matrix-security-summary`.

## Global Constraints

- All commands run from the repo root `E:\Personal\looper` unless stated otherwise. Shell is Git Bash.
- **Job ids are `unit`, `lambda`, `e2e`, `security`, `summary`.** No hyphens: `needs.lint-unit.result` is not valid expression syntax, and every later task refers to these exact ids.
- **Every `if:` on `deploy` and `release` stays fail-closed.** A job result of `skipped` or `cancelled` must block. Never replace `== 'success'` with `!= 'failure'`.
- **`summary` is never in any `needs:` list.** It reports; it does not gate.
- **Cross-OS legs run only on `workflow_dispatch` and `pull_request` into `stage`/`main`.** Windows costs ~2x and macOS ~10x Linux minutes against the free quota (spec §2). Do not widen this without the user's say-so.
- **Windows runners default to PowerShell.** The `e2e` job carries `defaults: run: shell: bash`. Every `run:` step in it is bash.
- **`security` ships with `exit-code: "0"` (Task 5) and is flipped to `"1"` only after the dispatched run's findings are triaged (Task 8).**
- **Emoji in summaries is limited to the status column of the rollup table** (✅ ❌ ⏭️ 🚫) and the ⚠️ the existing `test-summary.mjs` already uses for a crashed run. Nowhere else; unknown states are plain text.
- Node scripts under `.github/scripts/` are ESM (`.mjs`), tested by `node --test ".github/scripts/*.test.mjs"` (quoted glob, always: a bare directory argument makes Node's default discovery pick up `test-summary.mjs` as a test file, since it matches `test-*.mjs`, and it exits 1 on usage), and must run on Node 22 with no dependencies.
- **`deploy` only runs on `main`/`dev`/`stage`.** The `bgm-looper-ci-deploy` role's OIDC trust policy (`infra/main/shared.tf`) is `StringEquals` on exactly those three refs, and the job's `case` has no default arm, so a `workflow_dispatch` from any other branch fails at `configure-aws-credentials`. Task 6 adds the branch clause; Task 7's dispatch relies on it.
- Pin actions to the exact tags named here: `aquasecurity/trivy-action@v0.36.0`, `actions/setup-node@v7`, `actions/checkout@v7`, `actions/setup-python@v7` (the latter three are what the file already uses).
- `CHANGELOG.md` gets its entry under `## [Unreleased]` on this branch (Task 9).
- Every commit message ends with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.
- Validate YAML after every edit to `deploy.yml` with the Python one-liner in Task 3 Step 6. `lambda/.venv/Scripts/python` has PyYAML? Check with `lambda/.venv/Scripts/python -c "import yaml"`; if not, `lambda/.venv/Scripts/python -m pip install pyyaml` once.
- Do not touch `infra/`, `playwright.config.ts`, `vitest.config.ts`, or `.github/workflows/release-tests.yml`.

## File map

| File | Change | Responsibility |
|---|---|---|
| `.github/workflows/deploy.yml` | Modify | Job split, matrix, concurrency, gating |
| `.github/scripts/test-summary.mjs` | Modify | Accept `--label` so matrix legs are distinguishable |
| `.github/scripts/test-summary.test.mjs` | Create | `node:test` coverage for the label and the existing crash-file paths |
| `.github/scripts/run-summary.mjs` | Create | Rollup table from `toJSON(needs)` |
| `.github/scripts/run-summary.test.mjs` | Create | Its tests |
| `.github/scripts/security-summary.mjs` | Create | Trivy table → job summary section |
| `.github/scripts/security-summary.test.mjs` | Create | Its tests |
| `.trivyignore` | Create (Task 8, only if triage needs it) | Accepted findings, one reason per line |
| `CLAUDE.md` | Modify | Three bullets naming the `test` job |
| `docs/runbooks/infra-apply-teardown.md`, `docs/runbooks/release-promotion.md` | Modify | Same rename |
| `CHANGELOG.md` | Modify | `[Unreleased]` entry |

---

### Task 0: Cut the branch

**Files:** none

The issue already exists (#212); do not file another.

- [ ] **Step 1: Cut the branch**

```bash
git checkout dev && git pull --ff-only origin dev && git checkout -b feat/ci-matrix-security-summary
```

---

### Task 1: `test-summary.mjs` takes a `--label`

**Files:**
- Modify: `.github/scripts/test-summary.mjs:1-8` (argv parsing) and the two heading sites
- Create: `.github/scripts/test-summary.test.mjs`

**Interfaces:**
- Produces: CLI `node test-summary.mjs --kind <vitest|playwright> [--label <text>] <results-file>`. With `--label X` the section heading becomes `## E2E + accessibility tests (Playwright) — X`. Without it, output is byte-identical to today.

- [ ] **Step 1: Write the failing tests**

`.github/scripts/test-summary.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = fileURLToPath(new URL("./test-summary.mjs", import.meta.url));

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_STEP_SUMMARY: "", ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function playwrightReport() {
  return JSON.stringify({
    suites: [
      {
        specs: [
          { title: "home renders", file: "pages.spec.ts", tests: [{ results: [{ status: "passed" }] }] },
        ],
        suites: [],
      },
    ],
  });
}

test("no --label: heading is unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "ts-"));
  const file = join(dir, "pw.json");
  writeFileSync(file, playwrightReport());
  const { status, stdout } = run(["--kind", "playwright", file]);
  assert.equal(status, 0);
  assert.match(stdout, /^## E2E \+ accessibility tests \(Playwright\)\n/);
  assert.match(stdout, /\*\*1 passed\*\*, \*\*0 failed\*\*, 0 skipped, 1 total/);
});

test("--label appends to the heading", () => {
  const dir = mkdtempSync(join(tmpdir(), "ts-"));
  const file = join(dir, "pw.json");
  writeFileSync(file, playwrightReport());
  const { status, stdout } = run(["--kind", "playwright", "--label", "Windows", file]);
  assert.equal(status, 0);
  assert.match(stdout, /^## E2E \+ accessibility tests \(Playwright\) — Windows\n/);
});

test("--label also applies to the missing-file warning", () => {
  const { status, stdout } = run(["--kind", "vitest", "--label", "Linux", "/nope/none.json"]);
  assert.equal(status, 0);
  assert.match(stdout, /^## Unit tests \(Vitest\) — Linux\n/);
  assert.match(stdout, /No results file found/);
});

test("usage error without --kind", () => {
  const { status } = run(["--label", "x", "file.json"]);
  assert.equal(status, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test ".github/scripts/*.test.mjs"`
Expected: the two `--label` tests FAIL (heading has no ` — Windows` / the script treats `--label` as the file path). The "no --label" test passes already.

- [ ] **Step 3: Implement**

Replace lines 1–8 of `.github/scripts/test-summary.mjs` (the `const [, , flag, kind, filePath]` block and its usage check) with:

```js
import { readFileSync, appendFileSync, existsSync } from "node:fs";

let kind;
let label = "";
let filePath;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--kind") kind = argv[++i];
  else if (argv[i] === "--label") label = argv[++i] ?? "";
  else filePath = argv[i];
}
if ((kind !== "vitest" && kind !== "playwright") || !filePath) {
  console.error("Usage: node test-summary.mjs --kind <vitest|playwright> [--label <text>] <results-file>");
  process.exit(1);
}
```

Then change the three heading sites so they all come from one place. Add, just below the `fence` function:

```js
const baseHeading =
  kind === "vitest" ? "## Unit tests (Vitest)" : "## E2E + accessibility tests (Playwright)";
const heading = label ? `${baseHeading} — ${label}` : baseHeading;
```

In `summarizeVitest`, change `const lines = ["## Unit tests (Vitest)", ""];` to `const lines = [heading, ""];`.
In `summarizePlaywright`, change `const lines = ["## E2E + accessibility tests (Playwright)", ""];` to `const lines = [heading, ""];`.
Delete the existing

```js
const heading =
  kind === "vitest" ? "## Unit tests (Vitest)" : "## E2E + accessibility tests (Playwright)";
```

block lower in the file (it is now defined above). The two `[heading, "", ...]` warning arrays below it stay as they are.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test ".github/scripts/*.test.mjs"`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/test-summary.mjs .github/scripts/test-summary.test.mjs
git commit -m "$(cat <<'EOF'
feat(ci): test-summary.mjs takes a --label so matrix legs are distinguishable

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 2: `run-summary.mjs` rollup table

**Files:**
- Create: `.github/scripts/run-summary.mjs`
- Create: `.github/scripts/run-summary.test.mjs`

**Interfaces:**
- Consumes: env `NEEDS` = `${{ toJSON(needs) }}` (an object keyed by job id with `.result`), env `EVENT_NAME` = `${{ github.event_name }}`, env `BASE_REF` = `${{ github.base_ref }}`.
- Produces: appends a markdown table to `$GITHUB_STEP_SUMMARY` (or stdout when unset). Exit 0 always; exit 1 only on unparseable `NEEDS`.

- [ ] **Step 1: Write the failing tests**

`.github/scripts/run-summary.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./run-summary.mjs", import.meta.url));

function run(env) {
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_STEP_SUMMARY: "", ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const needs = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { result: v, outputs: {} }])));

test("all green renders four rows with ✅ and the Linux-only note", () => {
  const { status, stdout } = run({
    NEEDS: needs({ unit: "success", lambda: "success", e2e: "success", security: "success" }),
    EVENT_NAME: "pull_request",
    BASE_REF: "dev",
  });
  assert.equal(status, 0);
  assert.match(stdout, /^## CI summary\n/);
  assert.match(stdout, /\| Lint \+ unit tests \| ✅ success \|/);
  assert.match(stdout, /\| Lambda tests \| ✅ success \|/);
  assert.match(stdout, /\| E2E \(Playwright\) \| ✅ success \|/);
  assert.match(stdout, /\| Security scan \| ✅ success \|/);
  assert.match(stdout, /Cross-OS e2e: no \(pull_request into dev\)/);
});

test("failure, skipped and cancelled map to ❌ ⏭️ 🚫", () => {
  const { stdout } = run({
    NEEDS: needs({ unit: "failure", lambda: "skipped", e2e: "cancelled", security: "success" }),
    EVENT_NAME: "push",
    BASE_REF: "",
  });
  assert.match(stdout, /\| Lint \+ unit tests \| ❌ failure \|/);
  assert.match(stdout, /\| Lambda tests \| ⏭️ skipped \|/);
  assert.match(stdout, /\| E2E \(Playwright\) \| 🚫 cancelled \|/);
  assert.match(stdout, /Cross-OS e2e: no \(push\)/);
});

test("promotion PR and dispatch say cross-OS ran", () => {
  const base = needs({ unit: "success", lambda: "success", e2e: "success", security: "success" });
  assert.match(run({ NEEDS: base, EVENT_NAME: "pull_request", BASE_REF: "stage" }).stdout, /Cross-OS e2e: yes \(pull_request into stage\)/);
  assert.match(run({ NEEDS: base, EVENT_NAME: "workflow_dispatch", BASE_REF: "" }).stdout, /Cross-OS e2e: yes \(workflow_dispatch\)/);
});

test("unknown jobs are listed by id so a renamed job is not silently dropped", () => {
  const { stdout } = run({
    NEEDS: needs({ unit: "success", lambda: "success", e2e: "success", security: "success", chromatic: "success" }),
    EVENT_NAME: "push",
    BASE_REF: "",
  });
  assert.match(stdout, /\| chromatic \| ✅ success \|/);
});

test("bad NEEDS exits 1", () => {
  assert.equal(run({ NEEDS: "not json", EVENT_NAME: "push", BASE_REF: "" }).status, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test ".github/scripts/*.test.mjs"`
Expected: the five `run-summary` tests FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

`.github/scripts/run-summary.mjs`:

```js
// Writes the one-glance table for the whole run. Step summaries are per
// job, so the only place a single overview can come from is a job that
// depends on every other one - that is the `summary` job in deploy.yml,
// which runs `if: always()` and hands us `toJSON(needs)`.
import { appendFileSync } from "node:fs";

const LABELS = {
  unit: "Lint + unit tests",
  lambda: "Lambda tests",
  e2e: "E2E (Playwright)",
  security: "Security scan",
};

const ICONS = {
  success: "✅",
  failure: "❌",
  skipped: "⏭️",
  cancelled: "🚫",
};

let needs;
try {
  needs = JSON.parse(process.env.NEEDS ?? "");
  if (!needs || typeof needs !== "object") throw new Error("not an object");
} catch (err) {
  console.error(`NEEDS is not the toJSON(needs) object: ${err.message}`);
  process.exit(1);
}

const eventName = process.env.EVENT_NAME ?? "";
const baseRef = process.env.BASE_REF ?? "";
const crossOs =
  eventName === "workflow_dispatch" ||
  (eventName === "pull_request" && (baseRef === "stage" || baseRef === "main"));
const where = eventName === "pull_request" ? `${eventName} into ${baseRef}` : eventName;

const lines = ["## CI summary", "", "| Job | Result |", "|---|---|"];
// Known jobs first, in a fixed order, then anything else by id so a job
// added to `needs:` without a label here still shows up.
const ids = [...Object.keys(LABELS).filter((id) => id in needs), ...Object.keys(needs).filter((id) => !(id in LABELS))];
for (const id of ids) {
  const result = needs[id]?.result ?? "unknown";
  lines.push(`| ${LABELS[id] ?? id} | ${ICONS[result] ?? ""} ${result} |`);
}
lines.push(
  "",
  `Cross-OS e2e: ${crossOs ? "yes" : "no"} (${where}). Runs on promotion PRs and workflow_dispatch.`,
);

const output = lines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
} else {
  console.log(output);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test ".github/scripts/*.test.mjs"`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/run-summary.mjs .github/scripts/run-summary.test.mjs
git commit -m "$(cat <<'EOF'
feat(ci): run-summary.mjs renders one status table for the whole run

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 3: `security-summary.mjs`

**Files:**
- Create: `.github/scripts/security-summary.mjs`
- Create: `.github/scripts/security-summary.test.mjs`

**Interfaces:**
- Consumes: CLI `node security-summary.mjs <trivy-table-file> <outcome>` where `<outcome>` is `${{ steps.trivy.outcome }}` (`success` or `failure`) and the file is Trivy's `--format table` output, possibly empty or missing. Trivy's table prints one count line per target with findings: `Total: N (HIGH: x, CRITICAL: y)` for vulnerabilities and secrets, `Failures: N (HIGH: x, CRITICAL: y)` for misconfiguration (checked against `pkg/report/table/{vulnerability,secret,misconfig}.go`). The script sums the `N`s across both forms. A clean run on current Trivy prints only the "Report Summary" box and no count line at all.
- Produces: appends a `## Security scan (Trivy)` section in one of three states, in this order: findings (sum > 0, shown expanded, whatever `outcome` says — in report-only mode `outcome` is always `success`), else clean when `outcome` is `success` (whether the table is empty, summary-only, or has zero counts), else scan error (e.g. the DB download was rate-limited). Exit 0 always.

- [ ] **Step 1: Write the failing tests**

`.github/scripts/security-summary.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = fileURLToPath(new URL("./security-summary.mjs", import.meta.url));

function run(args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
  });
  return { status: r.status, stdout: r.stdout };
}

function tmpFile(content) {
  const file = join(mkdtempSync(join(tmpdir(), "sec-")), "trivy.txt");
  writeFileSync(file, content);
  return file;
}

test("clean: outcome success and zero totals", () => {
  const { status, stdout } = run([tmpFile("web/package-lock.json (npm)\n\nTotal: 0 (HIGH: 0, CRITICAL: 0)\n"), "success"]);
  assert.equal(status, 0);
  assert.match(stdout, /^## Security scan \(Trivy\)\n/);
  assert.match(stdout, /No HIGH or CRITICAL findings with a fix available\./);
  assert.match(stdout, /<details><summary>Scanner output<\/summary>/);
  assert.match(stdout, /Total: 0/);
});

test("clean: outcome success and an empty table prints no code block", () => {
  const { stdout } = run([tmpFile(""), "success"]);
  assert.match(stdout, /No HIGH or CRITICAL findings with a fix available\./);
  assert.doesNotMatch(stdout, /```/);
});

test("clean: outcome success with only the Report Summary box and no count line is still clean", () => {
  const table = "Report Summary\n\n| Target | Type | Vulnerabilities | Misconfigurations | Secrets |\n| web/package-lock.json | npm | 0 | - | - |\n";
  const { stdout } = run([tmpFile(table), "success"]);
  assert.match(stdout, /No HIGH or CRITICAL findings with a fix available\./);
  assert.doesNotMatch(stdout, /did not complete/);
  assert.match(stdout, /<details><summary>Scanner output<\/summary>/);
});

test("misconfiguration findings use Failures: lines and are counted too", () => {
  const table = "infra/main/shared.tf (terraform)\n\nTests: 40 (SUCCESSES: 38, FAILURES: 2)\nFailures: 2 (HIGH: 2, CRITICAL: 0)\n\nHIGH: S3 bucket does not have logging enabled.\n";
  const { stdout } = run([tmpFile(table), "success"]);
  assert.match(stdout, /2 findings at HIGH or CRITICAL with a fix available\./);
  assert.match(stdout, /logging enabled/);
});

test("findings are detected from the table even when outcome is success (report-only mode)", () => {
  const table = "web/package-lock.json (npm)\n\nTotal: 1 (HIGH: 1, CRITICAL: 0)\n\n| Library | Vulnerability |\n| next | CVE-2026-0001 |\n\ninfra/main/shared.tf (terraform)\n\nTotal: 2 (HIGH: 2, CRITICAL: 0)\n";
  const { status, stdout } = run([tmpFile(table), "success"]);
  assert.equal(status, 0);
  assert.match(stdout, /3 findings at HIGH or CRITICAL with a fix available\./);
  assert.match(stdout, /CVE-2026-0001/);
  assert.doesNotMatch(stdout, /<details>/);
});

test("findings with outcome failure read the same", () => {
  const { stdout } = run([tmpFile("x (npm)\n\nTotal: 1 (HIGH: 0, CRITICAL: 1)\n"), "failure"]);
  assert.match(stdout, /1 finding at HIGH or CRITICAL with a fix available\./);
});

test("scan error: outcome failure with no Total line is not reported as findings", () => {
  const { status, stdout } = run([tmpFile("FATAL: failed to download vulnerability DB\n"), "failure"]);
  assert.equal(status, 0);
  assert.match(stdout, /⚠️ The scanner did not complete \(outcome: failure\)/);
  assert.doesNotMatch(stdout, /findings? at HIGH/);
  assert.match(stdout, /failed to download/);
});

test("missing file is a scan error too", () => {
  const { status, stdout } = run(["/nope/trivy.txt", "failure"]);
  assert.equal(status, 0);
  assert.match(stdout, /⚠️ The scanner did not complete \(outcome: failure\)/);
  assert.match(stdout, /No scanner output found at/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test ".github/scripts/*.test.mjs"`
Expected: the eight `security-summary` tests FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

`.github/scripts/security-summary.mjs`:

```js
// Renders Trivy's `--format table` output into the job summary. The Security
// tab (SARIF upload) needs Advanced Security, which this private repo does
// not have, so the summary is where findings live.
import { readFileSync, appendFileSync, existsSync } from "node:fs";

const [, , filePath, outcome] = process.argv;
if (!filePath || !outcome) {
  console.error("Usage: node security-summary.mjs <trivy-table-file> <success|failure>");
  process.exit(1);
}

// Same guard as test-summary.mjs: wrap in one more backtick than the longest
// run inside the body so a fence in the table cannot close ours early.
function fence(body) {
  const longest = Math.max(0, ...(String(body).match(/`+/g) ?? []).map((m) => m.length));
  return "`".repeat(Math.max(3, longest + 1));
}

// One count line per target that has findings: `Total: N (...)` for
// vulnerabilities and secrets, `Failures: N (...)` for misconfiguration
// (pkg/report/table/{vulnerability,secret,misconfig}.go in Trivy). A clean
// run prints only the Report Summary box and no count line at all.
function countFindings(table) {
  return [...table.matchAll(/^(?:Total|Failures): (\d+) \(/gm)]
    .map((m) => Number(m[1]))
    .reduce((a, b) => a + b, 0);
}

// Three states, in this order, and findings are decided from the table,
// never from the step outcome: in report-only mode (exit-code "0") the
// outcome is `success` no matter what was found, and once gating is on a
// DB-download failure is `failure` with no table at all.
const lines = ["## Security scan (Trivy)", ""];
const table = existsSync(filePath) ? readFileSync(filePath, "utf8").trim() : null;
const findings = table === null ? 0 : countFindings(table);
const f = fence(table ?? "");

if (findings > 0) {
  lines.push(`${findings} finding${findings === 1 ? "" : "s"} at HIGH or CRITICAL with a fix available.`, "", f, table, f);
} else if (outcome === "success") {
  lines.push("No HIGH or CRITICAL findings with a fix available.");
  if (table) {
    lines.push("", "<details><summary>Scanner output</summary>", "", f, table, f, "</details>");
  }
} else {
  lines.push(`⚠️ The scanner did not complete (outcome: ${outcome}) - no findings were evaluated. Rerun the job; if it repeats, read the log.`);
  if (table === null) {
    lines.push("", `No scanner output found at \`${filePath}\`.`);
  } else if (table) {
    lines.push("", f, table, f);
  }
}

const output = lines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
} else {
  console.log(output);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test ".github/scripts/*.test.mjs"`
Expected: 17 passing.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/security-summary.mjs .github/scripts/security-summary.test.mjs
git commit -m "$(cat <<'EOF'
feat(ci): security-summary.mjs renders the Trivy table into the job summary

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

- [ ] **Step 6: Record the YAML validator used by every later task**

Confirm it runs (no output means valid):

```bash
lambda/.venv/Scripts/python -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"
```

If `ModuleNotFoundError: yaml`: `lambda/.venv/Scripts/python -m pip install pyyaml`, then rerun.

---

### Task 4: Split `test` into `unit`, `lambda`, `e2e`

**Files:**
- Modify: `.github/workflows/deploy.yml:14-90` (the whole `test:` job)

**Interfaces:**
- Produces: jobs `unit`, `lambda`, `e2e`. `deploy` and `release` still reference `test` after this task and the workflow is **invalid until Task 6**; that is expected, do not push between Tasks 4 and 6.

- [ ] **Step 1: Replace the `test:` job**

Delete lines 15–90 (from `  test:` through `        run: exit 1`) and insert:

```yaml
  unit:
    name: Lint + unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Install app dependencies
        working-directory: web
        run: npm install

      - name: Lint app
        id: lint
        working-directory: web
        run: |
          EXIT_CODE=0
          npm run lint || EXIT_CODE=$?
          echo "exit_code=$EXIT_CODE" >> "$GITHUB_OUTPUT"

      - name: Run app tests
        id: vitest
        working-directory: web
        run: |
          set -o pipefail
          EXIT_CODE=0
          npx vitest run --reporter=default --reporter=json --outputFile.json=vitest-results.json || EXIT_CODE=$?
          echo "exit_code=$EXIT_CODE" >> "$GITHUB_OUTPUT"

      - name: Vitest job summary
        if: always()
        run: node .github/scripts/test-summary.mjs --kind vitest web/vitest-results.json

      # The summary scripts this workflow's other jobs depend on.
      - name: Run CI script tests (Node)
        run: node --test ".github/scripts/*.test.mjs"

      - name: Fail the job if lint or the unit suite failed
        if: steps.lint.outputs.exit_code != '0' || steps.vitest.outputs.exit_code != '0'
        run: exit 1

  # Linux only on purpose: the tests need apt ffmpeg and the Lambda ships as
  # a Linux container, so another OS would test a platform it never runs on.
  lambda:
    name: Lambda tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Set up Python
        uses: actions/setup-python@v7
        with:
          python-version: "3.12"

      - name: Install ffmpeg
        run: sudo apt-get update && sudo apt-get install -y ffmpeg

      - name: Install Lambda test dependencies
        working-directory: lambda
        run: pip install -r requirements.txt pytest moto

      - name: Run Lambda tests
        working-directory: lambda
        run: pytest -v

      # The release job's changelog scripts. Cheap, and they are the only thing
      # standing between a bad merge base and issue #168 coming back.
      - name: Run CI script tests (Python)
        run: pytest -q .github/scripts/test_changelog_sync.py

  # Ubuntu on every run. Windows and macOS only where the free-plan minute
  # budget allows: promotion PRs into stage/main and manual dispatch. macOS
  # costs about 10x Linux minutes and Windows about 2x, so running them on
  # every PR would exhaust the 2,000 monthly minutes within days and stall
  # `release` with them. Spec §2-3.
  e2e:
    name: E2E (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: ${{ fromJSON((github.event_name == 'workflow_dispatch' || (github.event_name == 'pull_request' && (github.base_ref == 'stage' || github.base_ref == 'main'))) && '["ubuntu-latest", "windows-latest", "macos-latest"]' || '["ubuntu-latest"]') }}
    # Every step below is bash; windows-latest would otherwise run them in
    # PowerShell, where `set -o pipefail` and `$GITHUB_OUTPUT` do not exist.
    defaults:
      run:
        shell: bash
    steps:
      - uses: actions/checkout@v7

      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Install app dependencies
        working-directory: web
        run: npm install

      - name: Install Playwright browsers
        working-directory: web
        run: npx playwright install --with-deps chromium

      - name: Run e2e + a11y tests
        id: playwright
        working-directory: web
        run: |
          set -o pipefail
          EXIT_CODE=0
          npx playwright test || EXIT_CODE=$?
          echo "exit_code=$EXIT_CODE" >> "$GITHUB_OUTPUT"

      - name: Playwright job summary
        if: always()
        run: node .github/scripts/test-summary.mjs --kind playwright --label "${{ runner.os }}" web/playwright-results.json

      - name: Fail the job if the e2e suite failed
        if: steps.playwright.outputs.exit_code != '0'
        run: exit 1
```

- [ ] **Step 2: Validate YAML**

```bash
lambda/.venv/Scripts/python -c "import yaml; d=yaml.safe_load(open('.github/workflows/deploy.yml')); print(sorted(d['jobs']))"
```

Expected: `['changes', 'deploy', 'e2e', 'lambda', 'promotion-guard', 'release', 'unit']`.

- [ ] **Step 3: Confirm the matrix expression parses as a string, not a YAML list**

```bash
lambda/.venv/Scripts/python -c "import yaml; d=yaml.safe_load(open('.github/workflows/deploy.yml')); m=d['jobs']['e2e']['strategy']['matrix']['os']; assert isinstance(m,str) and m.startswith('\${{'), m; print('ok')"
```

Expected: `ok`. A YAML list here would mean the expression got split by hand; it must stay one `${{ }}` string. The ternary sits *inside* `fromJSON(...)` and chooses between two strings, which are unambiguously truthy in GitHub's expression language; `cond && fromJSON(a) || fromJSON(b)` would rely on array truthiness, which the docs do not promise.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "$(cat <<'EOF'
feat(ci): split test into unit, lambda and an OS-matrix e2e job

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 5: `security` job (report-only) and `summary` job

**Files:**
- Modify: `.github/workflows/deploy.yml` (insert after the `e2e` job, before `promotion-guard`)

**Interfaces:**
- Produces: job `security` with `exit-code: "0"` for now (Task 8 flips it), job `summary`.

- [ ] **Step 1: Insert the two jobs**

Immediately after the `e2e` job's last line (`        run: exit 1`) and before the `# Refuses a promotion whose merge base predates...` comment block, insert:

```yaml
  # Free on a private repo: one open-source action, no account, no licence.
  # CodeQL, dependency-review and SARIF upload all need Advanced Security,
  # which this plan does not have, so findings go to the job summary instead
  # of the Security tab. Dependabot alerts (free, already on) cover the rest.
  security:
    name: Security scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      # `ignore-unfixed`: a CVE with no patched release cannot block an
      # unrelated deploy; the only findings that fail the job are ones a
      # dependency bump would clear. `.trivyignore` at the repo root is the
      # escape hatch for accepted findings - one reason per entry.
      # exit-code is "0" until the first dispatched run's findings have been
      # triaged (see the plan); "1" after that.
      - name: Trivy filesystem scan
        id: trivy
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: fs
          scan-ref: .
          scanners: vuln,misconfig,secret
          severity: HIGH,CRITICAL
          ignore-unfixed: true
          exit-code: "0"
          format: table
          output: trivy-results.txt
          skip-dirs: web/node_modules,web/.next,lambda/.venv
        continue-on-error: true

      - name: Security job summary
        if: always()
        run: node .github/scripts/security-summary.mjs trivy-results.txt "${{ steps.trivy.outcome }}"

      - name: Fail the job if the scan found anything
        if: steps.trivy.outcome != 'success'
        run: exit 1

  # Reports, never gates: absent from every other job's `needs:`. Step
  # summaries are per job, so the only place a one-glance table can come
  # from is a job that depends on all the others.
  summary:
    name: Summary
    needs: [unit, lambda, e2e, security]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Write the run summary
        env:
          NEEDS: ${{ toJSON(needs) }}
          EVENT_NAME: ${{ github.event_name }}
          BASE_REF: ${{ github.base_ref }}
        run: node .github/scripts/run-summary.mjs
```

- [ ] **Step 2: Validate**

```bash
lambda/.venv/Scripts/python -c "import yaml; d=yaml.safe_load(open('.github/workflows/deploy.yml')); j=d['jobs']; print(sorted(j)); assert j['summary']['needs']==['unit','lambda','e2e','security']; assert all('summary' not in (v.get('needs') or []) for v in j.values()); assert j['security']['steps'][1]['with']['exit-code']=='0'; print('ok')"
```

Expected: the job list now includes `security` and `summary`, then `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "$(cat <<'EOF'
feat(ci): add a report-only Trivy security job and a summary rollup

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 6: Re-point `deploy` and `release` gating, add `concurrency`

**Files:**
- Modify: `.github/workflows/deploy.yml` — `deploy.needs`, `deploy.if`, `release.needs`, `release.if`, top-level `concurrency`

**Interfaces:**
- Consumes: job ids `unit`, `lambda`, `e2e`, `security` from Tasks 4–5.

- [ ] **Step 1: `deploy`**

Change

```yaml
  deploy:
    needs: [test, changes]
```

to

```yaml
  deploy:
    needs: [unit, lambda, e2e, security, changes]
```

and in its `if:` replace `needs.test.result == 'success'` with

```
needs.unit.result == 'success' && needs.lambda.result == 'success' && needs.e2e.result == 'success' && needs.security.result == 'success'
```

and add a branch clause, so the full line reads:

```yaml
    if: always() && contains(fromJSON('["main", "dev", "stage"]'), github.ref_name) && needs.unit.result == 'success' && needs.lambda.result == 'success' && needs.e2e.result == 'success' && needs.security.result == 'success' && (github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && needs.changes.result == 'success' && needs.changes.outputs.lambda == 'true'))
```

In the comment above it, change `test's success is checked explicitly here` to `each test job's success is checked explicitly here`, and add these lines to the end of that comment block:

```yaml
    # The branch clause exists for workflow_dispatch from a feature branch
    # (the way the cross-OS e2e matrix is exercised before a promotion). The
    # bgm-looper-ci-deploy role's OIDC trust policy is StringEquals on the
    # three permanent branches' refs, so any other branch fails at
    # configure-aws-credentials, and the `case` below has no default arm, so
    # TAG_PREFIX would be empty even if it got that far. Skipping is the
    # honest result; a red deploy on a branch that can never deploy is noise.
```

`release` needs no such clause: it already requires `github.ref == 'refs/heads/main'`, and a skipped `deploy` on a feature branch is not `failure`/`cancelled`, so its existing `if:` reads correctly.

- [ ] **Step 2: `release`**

Change

```yaml
  release:
    needs: [test, deploy, changes]
```

to

```yaml
  release:
    needs: [unit, lambda, e2e, security, deploy, changes]
```

and in its `if:` replace `needs.test.result == 'success'` with the same four-clause block, so it reads:

```yaml
    if: always() && github.ref == 'refs/heads/main' && needs.unit.result == 'success' && needs.lambda.result == 'success' && needs.e2e.result == 'success' && needs.security.result == 'success' && needs.deploy.result != 'failure' && needs.deploy.result != 'cancelled' && (github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && needs.changes.result == 'success' && needs.changes.outputs.releasable == 'true'))
```

In the comment above it, change `test.result is checked explicitly too` to `the four test jobs' results are checked explicitly too` and `"test failed so deploy's own condition never ran"` to `"a test job failed so deploy's own condition never ran"`.

- [ ] **Step 3: `concurrency`**

Between the `on:` block and `env:` insert:

```yaml
# A new push to a PR cancels the run it supersedes. Push runs are keyed on
# the SHA so they are never cancelled and never queue behind each other:
# cancelling one could kill `deploy` mid update-function-code or `release`
# between the changelog commit and the tag.
concurrency:
  group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.sha }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

- [ ] **Step 4: Validate — no `test` left anywhere**

```bash
lambda/.venv/Scripts/python - <<'PY'
import yaml
d = yaml.safe_load(open(".github/workflows/deploy.yml"))
j = d["jobs"]
assert "test" not in j
for name in ("deploy", "release"):
    assert "test" not in j[name]["needs"], name
    assert "needs.test." not in j[name]["if"], name
    for job in ("unit", "lambda", "e2e", "security"):
        assert f"needs.{job}.result == 'success'" in j[name]["if"], (name, job)
assert """contains(fromJSON('["main", "dev", "stage"]'), github.ref_name)""" in j["deploy"]["if"]
assert d["concurrency"]["cancel-in-progress"].strip().startswith("${{")
print("ok")
PY
grep -n "needs\.test\b\|\[test," .github/workflows/deploy.yml || echo "no stale test refs"
```

Expected: `ok` then `no stale test refs`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "$(cat <<'EOF'
feat(ci): gate deploy and release on the four split jobs; cancel superseded PR runs

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 7: Push, open the PR, run the measurement dispatch

**Files:** none

- [ ] **Step 1: Push and open the PR (draft)**

```bash
git push -u origin feat/ci-matrix-security-summary
gh pr create --base dev --draft \
  --title "feat(ci): split test, cross-OS e2e on promotions, free security scan, run summary" \
  --body "$(cat <<'EOF'
Closes #212

Spec: docs/superpowers/specs/2026-09-18-ci-matrix-security-summary-design.md
Plan: docs/superpowers/plans/2026-09-18-ci-matrix-security-summary.md

- `test` → `unit`, `lambda`, `e2e` (matrix), `security` (Trivy, report-only until triaged), `summary` (one table).
- Windows + macOS e2e only on promotion PRs and workflow_dispatch: free-plan minute budget.
- `deploy`/`release` gate on all four; `summary` gates nothing.
- `concurrency` cancels superseded PR runs, never push runs.

Draft until the dispatched measurement run below has been read and Trivy has been flipped to gating.
EOF
)"
```

- [ ] **Step 2: Watch the PR run**

```bash
gh pr checks --watch --interval 20
```

Expected: `Lint + unit tests`, `Lambda tests`, `E2E (ubuntu-latest)`, `Security scan`, `Summary` all green; `changes`/`deploy`/`release` skipped. Open the run in the browser and check the job summary has the Vitest section (from `unit`), the Playwright section with ` — Linux` (from `e2e`), the Trivy section (from `security`), and the rollup table with `Cross-OS e2e: no (pull_request into dev)` (from `summary`).

If `Security scan` is red here: `exit-code` is `"0"`, so a red job means the action itself failed (DB download rate-limited is the common one). Rerun once with `gh run rerun <id> --failed`; if it repeats, read the log before changing anything.

- [ ] **Step 3: Dispatch the cross-OS measurement run**

```bash
gh workflow run deploy.yml --ref feat/ci-matrix-security-summary
sleep 10
gh run list --workflow=deploy.yml --branch feat/ci-matrix-security-summary --limit 1 --json databaseId,event -q '.[0]'
gh run watch <databaseId> --exit-status || true
```

Expected: `E2E (windows-latest)` and `E2E (macos-latest)` legs appear and pass. `deploy` shows **skipped**, not red: the branch clause added in Task 6 excludes feature branches (the OIDC trust policy would reject the token, and an empty `TAG_PREFIX` would make `describe-images` fail on the malformed tag `-<sha>` before that). `release` is skipped too (`github.ref` is not `main`). `changes` is skipped (dispatch, not push). Confirm all three in the run before moving on; a red `deploy` here means the Task 6 clause is missing or misspelled.

Also confirm the Trivy section in `Security scan`'s summary. It is report-only at this point, so the job is green whatever it found; the summary's first line says either `No HIGH or CRITICAL findings` or `N findings at HIGH or CRITICAL`, decided from the table, not the outcome. That list is what Task 8 triages.

- [ ] **Step 4: Record the measured durations**

```bash
MSYS_NO_PATHCONV=1 gh api repos/DataCrusade1999/supreme-enigma/actions/runs/<databaseId>/jobs \
  -q '.jobs[] | "\(.name)\t\(.started_at)\t\(.completed_at)"'
```

Write the three `E2E (...)` wall-clock minutes into the spec's §3 table, replacing the estimates, and commit that with Task 9. If a Windows or macOS leg failed on `webServer` timeout (`Timed out waiting 180000ms`), stop and report; raising the timeout touches `playwright.config.ts`, which is out of scope until the user decides.

---

### Task 8: Triage Trivy and flip it to gating

**Files:**
- Modify: `.github/workflows/deploy.yml` (`exit-code: "0"` → `"1"`)
- Create: `.trivyignore` (only if triage leaves accepted findings)

- [ ] **Step 1: Read the findings**

Open the dispatched run's `Security scan` job summary. For every row at HIGH/CRITICAL, decide one of:

- **Fix**: an npm dependency with a fixed version → `cd web && npm install <pkg>@<fixed>` and commit; a Dockerfile/Terraform misconfig with a one-line remedy that does not change behaviour → fix it. Anything touching `infra/` needs `terraform plan` showing `No changes.` or an explained diff before it is committed (CLAUDE.md qualifier).
- **Accept**: add the ID to `.trivyignore` with a comment line above it saying why, e.g.

```
# AVD-AWS-0089: S3 access logging. The buckets hold 1-day-expiring audio; logging would cost more than the data. Accepted 2026-09-xx.
AVD-AWS-0089
```

Never accept a `secret` finding; if one is real, rotate it and remove it from the tree, then reply on the PR thread with what was rotated.

- [ ] **Step 2: Flip the gate**

In the `security` job change `exit-code: "0"` to `exit-code: "1"` and delete the comment lines `# exit-code is "0" until the first dispatched run's findings have been` / `# triaged (see the plan); "1" after that.`

- [ ] **Step 3: Validate and push**

```bash
lambda/.venv/Scripts/python -c "import yaml; d=yaml.safe_load(open('.github/workflows/deploy.yml')); assert d['jobs']['security']['steps'][1]['with']['exit-code']=='1'; print('ok')"
git add .github/workflows/deploy.yml .trivyignore 2>/dev/null; git add .github/workflows/deploy.yml
git commit -m "$(cat <<'EOF'
feat(ci): Trivy findings now fail the security job

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
git push
gh pr checks --watch --interval 20
```

Expected: `Security scan` green with the gate on. If it is red, the summary shows what was missed in Step 1; go back to it.

---

### Task 9: Docs, changelog, PR out of draft

**Files:**
- Modify: `CLAUDE.md` lines 21, 43, 51
- Modify: `docs/runbooks/infra-apply-teardown.md:27`, `docs/runbooks/release-promotion.md:122,130`
- Modify: `CHANGELOG.md` under `## [Unreleased]`
- Modify: `docs/superpowers/specs/2026-09-18-ci-matrix-security-summary-design.md` §3 (measured minutes from Task 7)

- [ ] **Step 1: `CLAUDE.md`**

Line 21, replace `**This is only half the CI gate** — CI's \`test\` job runs Vitest *and* Playwright and fails if either fails.` with:

```
**This is a fraction of the CI gate** — CI runs Vitest in the `unit` job, Playwright in the `e2e` job (Linux always; Windows and macOS only on promotion PRs and `workflow_dispatch`, because macOS costs ~10x Linux minutes against the free plan's 2,000/month), pytest in `lambda`, and Trivy in `security`. `deploy`/`release` need all four green.
```

Line 43, replace `The \`test\` job pipes both runners' JSON reports through` with `The \`unit\` and \`e2e\` jobs pipe their runners' JSON reports through`, and append to that bullet: ` \`e2e\` passes \`--label "${{ runner.os }}"\` so the matrix legs' sections are distinguishable. A \`summary\` job renders one table for the whole run from \`toJSON(needs)\` via \`.github/scripts/run-summary.mjs\`; it gates nothing.`

Line 51, replace `**Wait for CI \`test\` to complete green.**` with `**Wait for every CI job to complete green: \`unit\`, \`lambda\`, \`e2e\`, \`security\`.**`, and replace `\`changes\`/\`deploy\`/\`release\` showing \`SKIPPED\` on a PR is normal` with `\`changes\`/\`deploy\`/\`release\` showing \`SKIPPED\` on a PR is normal, and \`summary\` is informational`.

- [ ] **Step 2: Runbooks**

`docs/runbooks/infra-apply-teardown.md:27`: `A green \`test\` job says nothing` → `Green test jobs say nothing`.
`docs/runbooks/release-promotion.md:122`: `while \`test\` and the readiness review are absent` → `while the test jobs and the readiness review are absent`.
`docs/runbooks/release-promotion.md:130`: `An absent \`test\` here means gated` → `Absent test jobs here mean gated`.

Then confirm nothing else names the old job:

```bash
grep -rn "\`test\` job\|CI \`test\`\|needs.test" CLAUDE.md docs .github README.md ARCHITECTURE.md .claude/rules || echo clean
```

Expected: `clean`. Any hit is one more sentence to reword the same way.

- [ ] **Step 3: `CHANGELOG.md`**

Under `## [Unreleased]`, above the existing `### Fixed`, add:

```markdown
### Added

- `deploy.yml` runs Playwright on Windows and macOS as well as Linux, on
  promotion PRs into `stage`/`main` and on `workflow_dispatch` only. The repo
  is private on GitHub Free (2,000 minutes/month) and macOS runners cost about
  10x Linux against that quota, so cross-OS on every PR would stall CI, and
  `release` with it, within days.
- A `security` job runs Trivy over the tree (npm lockfile vulnerabilities,
  Dockerfile and Terraform misconfiguration, secrets) at HIGH/CRITICAL with
  `ignore-unfixed`, and fails the run on findings. Results go to the job
  summary: SARIF upload, CodeQL and dependency review all need Advanced
  Security, which is paid on private repos. `.trivyignore` holds accepted
  findings with a reason each.
- A `summary` job writes one status table for the whole run.

### Changed

- The single `test` job is now `unit`, `lambda`, `e2e` and `security`, run in
  parallel; `deploy` and `release` gate on all four. Unit tests stay
  Linux-only: Vitest runs under jsdom over pure logic and the Lambda ships as
  a Linux container, so other OS legs would spend minutes for no signal.
- Superseded PR runs are cancelled by a `concurrency` group; push runs never
  are, so a cancellation cannot land mid-`deploy` or mid-`release`.
- `test-summary.mjs` takes `--label`, and the two new summary scripts are
  covered by `node --test ".github/scripts/*.test.mjs"` in the `unit` job.
```

- [ ] **Step 4: Spec §3 measured numbers**

Replace the two estimate rows in the spec's §3 table with the Windows and macOS wall-clock minutes recorded in Task 7 Step 4, and change `the numbers above are estimates until then` to `measured on run <databaseId>`.

- [ ] **Step 5: Commit, push, un-draft**

```bash
git add CLAUDE.md docs CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: CI job rename in CLAUDE.md and runbooks; changelog entry; measured cross-OS minutes

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
git push
gh pr ready
```

- [ ] **Step 6: Merge per CLAUDE.md's sequence**

Follow "Merging a PR" in `CLAUDE.md` in full: all CI jobs green, `release-readiness-review` verdict is `change approved`, both bots' inline comments read with `--paginate` and triaged, threads resolved with a reply, then:

```bash
gh pr merge --squash --delete-branch
git checkout dev && git pull --ff-only origin dev
```

The push to `dev` touches `deploy.yml`, so `changes` reports `lambda=true` and `deploy` rebuilds `bgm-looper-processor-dev`. Expected. Let it finish before merging anything else that touches `lambda/`.

---

## Self-review

**Spec coverage.** §1 split → Tasks 4–6. §3 matrix + label → Task 4, Task 1. §4 Trivy report-only → gating → Tasks 5, 8. §5 unit Linux-only → Task 4 comment + changelog. §6 concurrency → Task 6. §7 summary → Tasks 2, 5. §8 gating → Task 6. §9 docs → Task 9. §2 measurement → Task 7. If #209 (Storybook) merges first: add `chromatic` to `summary`'s `needs:` in Task 5; `run-summary.mjs` already renders unknown ids by name (Task 2 test 4) and it must not be added to `deploy`/`release`.

**Placeholders.** `<databaseId>` is a value the executor reads off `gh` output in Task 7, not a TBD. `.trivyignore` content depends on the dispatched run and is described by shape and rule (Task 8).

**Name consistency.** Job ids `unit`/`lambda`/`e2e`/`security`/`summary` are the same in Tasks 2 (LABELS keys), 4, 5, 6, 9 and the validators. Script CLIs: `test-summary.mjs --kind K [--label L] FILE` (Tasks 1, 4), `run-summary.mjs` env `NEEDS`/`EVENT_NAME`/`BASE_REF` (Tasks 2, 5), `security-summary.mjs FILE OUTCOME` (Tasks 3, 5).
