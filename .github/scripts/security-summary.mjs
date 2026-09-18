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
