// Renders one table for every OS the e2e matrix ran on.
//
// $GITHUB_STEP_SUMMARY is per job and a matrix leg *is* a job, so three legs
// cannot write into one summary. Each leg uploads its Playwright JSON as
// `playwright-results-<OS>` instead, and the `summary` job (which already
// needs: e2e and runs if: always()) points this script at the download
// directory.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fence, stripAnsi, blobLink, formatDuration, emit } from "./summary-lib.mjs";

const HEADING = "## E2E + accessibility tests (Playwright)";
const RESULTS_FILE = "playwright-results.json";
const ARTIFACT_PREFIX = "playwright-results-";
const SLOWEST = 5;

// spec.file is relative to config.rootDir, which is `web/` because that is
// where playwright.config.ts lives. Deriving it instead would need the leg's
// own GITHUB_WORKSPACE, and this script runs in a different job on a
// different runner — the Windows leg's path does not even have the same
// shape as this one's.
const SPEC_ROOT = "web/";

// runner.os values, in the order the matrix declares them.
const OS_ORDER = ["Linux", "Windows", "macOS"];
const OS_ICONS = { Linux: "🐧", Windows: "🪟", macOS: "🍎" };

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node e2e-summary.mjs <artifact-download-dir>");
  process.exit(1);
}

function discoverLegs(root) {
  if (!existsSync(root)) return [];
  const legs = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(ARTIFACT_PREFIX)) continue;
    const os = entry.name.slice(ARTIFACT_PREFIX.length);
    const file = join(root, entry.name, RESULTS_FILE);
    if (!existsSync(file)) {
      legs.push({ os, error: `no \`${RESULTS_FILE}\` in the artifact` });
      continue;
    }
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (!Array.isArray(data?.suites) || typeof data?.stats !== "object" || data.stats === null) {
        legs.push({ os, error: "the artifact is not a Playwright JSON report" });
        continue;
      }
      legs.push({ os, data });
    } catch (err) {
      legs.push({ os, error: `the report did not parse: ${err.message}` });
    }
  }
  const rank = (os) => {
    const i = OS_ORDER.indexOf(os);
    return i === -1 ? OS_ORDER.length : i;
  };
  legs.sort((a, b) => rank(a.os) - rank(b.os) || a.os.localeCompare(b.os));
  return legs;
}

// tests[].status, not tests[].results[]. A result is one attempt: walking it
// counts a retried test twice and reports a retried-then-passed test as both
// a failure and a pass. `status` is the verdict across attempts and carries
// `flaky`, which results[] cannot express at all.
function walkSuite(suite, leg) {
  for (const spec of suite.specs ?? []) {
    const path = SPEC_ROOT + spec.file;
    const cell = leg.specs.get(path) ?? { expected: 0, unexpected: 0, flaky: 0, skipped: 0, total: 0 };
    for (const t of spec.tests ?? []) {
      cell.total += 1;
      if (t.status === "unexpected") cell.unexpected += 1;
      else if (t.status === "flaky") cell.flaky += 1;
      else if (t.status === "skipped") cell.skipped += 1;
      else cell.expected += 1;

      const last = (t.results ?? [])[(t.results ?? []).length - 1];
      if (last && typeof last.duration === "number") {
        leg.slowest.push({ os: leg.os, title: spec.title, path, line: spec.line, duration: last.duration });
      }
      if (t.status === "unexpected") {
        const failing = (t.results ?? []).find((r) => r.error) ?? last;
        leg.failures.push({
          title: spec.title,
          path,
          line: spec.line,
          message: stripAnsi(failing?.error?.message ?? "no error message captured"),
        });
      }
    }
    leg.specs.set(path, cell);
  }
  for (const child of suite.suites ?? []) walkSuite(child, leg);
}

function analyse(legs) {
  for (const leg of legs) {
    leg.specs = new Map();
    leg.failures = [];
    leg.slowest = [];
    if (!leg.data) continue;
    for (const suite of leg.data.suites) walkSuite(suite, leg);
  }
  return legs;
}

function cell(c) {
  if (!c) return "–";
  if (c.unexpected > 0) return `❌ ${c.unexpected}/${c.total}`;
  if (c.flaky > 0) return `⚠️ ${c.flaky}/${c.total}`;
  if (c.skipped === c.total) return `⏭️ ${c.total}`;
  return `✅ ${c.expected}`;
}

function totalCell(leg) {
  if (!leg.data) return "⚠️";
  const s = leg.data.stats;
  const total = (s.expected ?? 0) + (s.unexpected ?? 0) + (s.flaky ?? 0) + (s.skipped ?? 0);
  if (s.unexpected > 0) return `**❌ ${s.unexpected}/${total}**`;
  if (s.flaky > 0) return `**⚠️ ${s.flaky}/${total}**`;
  return `**✅ ${s.expected ?? 0}**`;
}

function render(legs) {
  const lines = [HEADING, ""];

  const totals = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  for (const leg of legs) {
    if (!leg.data) continue;
    for (const k of Object.keys(totals)) totals[k] += leg.data.stats[k] ?? 0;
  }
  const ran = legs.filter((l) => l.data).length;
  lines.push(
    `**${totals.expected} passed**, ${totals.unexpected} failed, ${totals.flaky} flaky, ` +
      `${totals.skipped} skipped across ${ran} runner${ran === 1 ? "" : "s"}.`,
    "",
  );

  const header = legs.map((l) => `${OS_ICONS[l.os] ?? ""} ${l.os}`.trim());
  lines.push(`| Spec | ${header.join(" | ")} |`, `|---|${legs.map(() => "---").join("|")}|`);

  // No line anchor: a row is a whole spec file, and the first test's line
  // would send anyone who clicked it to an arbitrary one of them.
  const specs = [...new Set(legs.flatMap((l) => [...l.specs.keys()]))].sort();
  for (const path of specs) {
    lines.push(`| ${blobLink(path)} | ${legs.map((l) => cell(l.specs.get(path))).join(" | ")} |`);
  }
  lines.push(`| **Total** | ${legs.map(totalCell).join(" | ")} |`);
  lines.push(
    `| **Duration** | ${legs.map((l) => (l.data ? formatDuration(l.data.stats.duration) : "–")).join(" | ")} |`,
    "",
  );

  for (const leg of legs.filter((l) => l.error)) {
    lines.push(`⚠️ **${leg.os}**: ${leg.error}.`, "");
  }

  const slowest = legs.flatMap((l) => l.slowest).sort((a, b) => b.duration - a.duration).slice(0, SLOWEST);
  if (slowest.length) {
    lines.push("<details><summary>Slowest tests</summary>", "", "| Test | Spec | Runner | Duration |", "|---|---|---|---|");
    for (const t of slowest) {
      lines.push(`| ${t.title} | \`${t.path}\` | ${t.os} | ${formatDuration(t.duration)} |`);
    }
    lines.push("", "</details>", "");
  }

  const failing = legs.filter((l) => l.failures.length);
  if (failing.length) {
    lines.push("### Failures", "");
    for (const leg of failing) {
      lines.push(`#### ${OS_ICONS[leg.os] ?? ""} ${leg.os}`.trim(), "");
      for (const f of leg.failures) {
        lines.push(`<details><summary>❌ ${f.title} — ${f.path}</summary>`, "");
        const g = fence(f.message);
        lines.push(g, f.message, g, "", blobLink(f.path, f.line), "</details>", "");
      }
    }
  }
  return lines;
}

const legs = analyse(discoverLegs(dir));
emit(
  legs.length === 0
    ? [
        HEADING,
        "",
        `⚠️ No Playwright result artifacts found under \`${dir}\`. The e2e job was cancelled before any leg uploaded, or the download failed — check the job's own log.`,
      ]
    : render(legs),
);
