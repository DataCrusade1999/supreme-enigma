// Renders Vitest's JSON report into the `unit` job's step summary.
// Playwright is not handled here: its three matrix legs are separate jobs, so
// their summaries are combined by e2e-summary.mjs in the `summary` job.
import { readFileSync, existsSync } from "node:fs";
import { fence, blobLink, formatDuration, emit } from "./summary-lib.mjs";

const HEADING = "## Unit tests (Vitest)";
const SLOWEST = 5;

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node unit-summary.mjs <vitest-results.json>");
  process.exit(1);
}

// testResults[].name is an absolute path on the runner. GITHUB_WORKSPACE is
// the checkout root in this same job, so stripping it gives the repo-relative
// path the blob URL needs. Windows separators are normalised first because
// Vitest reports forward slashes even on Windows while the env var does not.
function repoRelative(absolute) {
  const norm = String(absolute).replace(/\\/g, "/");
  const root = (process.env.GITHUB_WORKSPACE ?? "").replace(/\\/g, "/").replace(/\/$/, "");
  if (root && norm.startsWith(root + "/")) return norm.slice(root.length + 1);
  return norm.split("/").pop();
}

// Vitest's top-level startTime is when the run began, including collection and
// transform, which is most of the wall clock on a cold cache. Pairing it with
// the last file's endTime reports what the step actually cost rather than the
// much smaller sum of assertion times.
function totalDuration(data) {
  const ends = data.testResults.map((f) => f.endTime).filter((n) => typeof n === "number");
  if (typeof data.startTime === "number" && ends.length) {
    return Math.max(...ends) - data.startTime;
  }
  return data.testResults
    .flatMap((f) => f.assertionResults ?? [])
    .reduce((a, t) => a + (typeof t.duration === "number" ? t.duration : 0), 0);
}

function slowestTable(data) {
  const all = [];
  for (const file of data.testResults) {
    for (const t of file.assertionResults ?? []) {
      if (typeof t.duration === "number") {
        all.push({ name: t.fullName, file: repoRelative(file.name), duration: t.duration });
      }
    }
  }
  if (all.length === 0) return [];
  all.sort((a, b) => b.duration - a.duration);
  const lines = [
    "<details><summary>Slowest tests</summary>",
    "",
    "| Test | File | Duration |",
    "|---|---|---|",
  ];
  for (const t of all.slice(0, SLOWEST)) {
    lines.push(`| ${t.name} | \`${t.file}\` | ${formatDuration(t.duration)} |`);
  }
  lines.push("", "</details>", "");
  return lines;
}

function failureLines(data) {
  const lines = [];
  // Grouped by file: a broken module usually fails several of its tests at
  // once, and a flat list buries that behind N identical stack traces.
  for (const file of data.testResults) {
    const failed = (file.assertionResults ?? []).filter((t) => t.status === "failed");
    if (failed.length === 0) continue;
    const rel = repoRelative(file.name);
    lines.push(
      `#### ${blobLink(rel)} — ${failed.length} failed`,
      "",
    );
    for (const t of failed) {
      lines.push(`<details><summary>❌ ${t.fullName}</summary>`, "");
      const body = (t.failureMessages || []).join("\n\n");
      const f = fence(body);
      lines.push(f, body, f, "</details>", "");
    }
  }
  return lines;
}

function summarize(data) {
  const lines = [
    HEADING,
    "",
    "| ✅ Passed | ❌ Failed | ⏭️ Skipped | Total | Duration |",
    "|---|---|---|---|---|",
    `| ${data.numPassedTests} | ${data.numFailedTests} | ${data.numPendingTests} | ${data.numTotalTests} | ${formatDuration(totalDuration(data))} |`,
    "",
  ];
  lines.push(...slowestTable(data));
  if (data.numFailedTests > 0) {
    lines.push("### Failures", "", ...failureLines(data));
  }
  return lines;
}

let summaryLines;
if (!existsSync(filePath)) {
  summaryLines = [
    HEADING,
    "",
    `⚠️ No results file found at \`${filePath}\` — the test run likely crashed before producing output.`,
  ];
} else {
  // A run killed mid-write (job timeout, disk full, reporter crash) leaves a
  // file that exists but doesn't parse, or parses to something that isn't a
  // report. Degrade to a warning rather than throwing — this step runs with
  // `if: always()`, and crashing here would cost us the counts as well.
  let data = null;
  let reason = "";
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
    // Check the shape the summarizer actually reads, not just "is an object":
    // an array or an unrelated object parses fine and then renders a summary
    // full of `undefined` counts, which is worse than saying nothing.
    if (typeof data?.numTotalTests !== "number" || !Array.isArray(data?.testResults)) {
      reason = `parsed to \`${JSON.stringify(data)?.slice(0, 60)}\`, which is not a vitest report`;
      data = null;
    }
  } catch (err) {
    reason = `is not valid JSON: ${err.message}`;
  }
  summaryLines = data
    ? summarize(data)
    : [HEADING, "", `⚠️ Results file at \`${filePath}\` ${reason} — the test run likely crashed mid-write.`];
}

emit(summaryLines);
