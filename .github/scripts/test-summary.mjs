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

// A failure message can itself contain a ``` block (a Vitest diff of MDX or
// markdown content, say), which would close the wrapping fence early and
// corrupt every entry after it. Wrap in one more backtick than the longest
// run appearing inside the body.
function fence(body) {
  const longest = Math.max(0, ...(String(body).match(/`+/g) ?? []).map((m) => m.length));
  return "`".repeat(Math.max(3, longest + 1));
}

const baseHeading =
  kind === "vitest" ? "## Unit tests (Vitest)" : "## E2E + accessibility tests (Playwright)";
const heading = label ? `${baseHeading} — ${label}` : baseHeading;

function summarizeVitest(data) {
  const lines = [heading, ""];
  lines.push(
    `**${data.numPassedTests} passed**, **${data.numFailedTests} failed**, ${data.numPendingTests} skipped, ${data.numTotalTests} total`,
  );
  lines.push("");
  if (data.numFailedTests > 0) {
    lines.push("### Failures", "");
    for (const file of data.testResults) {
      for (const assertion of file.assertionResults) {
        if (assertion.status !== "failed") continue;
        lines.push(`<details><summary>❌ ${assertion.fullName} (${file.name})</summary>`, "");
        const body = (assertion.failureMessages || []).join("\n\n");
        const f = fence(body);
        lines.push(f, body, f, "</details>", "");
      }
    }
  }
  return lines;
}

function walkPlaywrightSuite(suite, failureLines, counts) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      for (const result of t.results) {
        counts.total += 1;
        if (result.status === "passed") counts.passed += 1;
        else if (result.status === "skipped") counts.skipped += 1;
        else {
          counts.failed += 1;
          const body = result.error?.message ?? "no error message captured";
          const f = fence(body);
          failureLines.push(
            `<details><summary>❌ ${spec.title} (${spec.file})</summary>`,
            "",
            f,
            body,
            f,
            "</details>",
            "",
          );
        }
      }
    }
  }
  for (const child of suite.suites ?? []) {
    walkPlaywrightSuite(child, failureLines, counts);
  }
}

function summarizePlaywright(data) {
  const failureLines = [];
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  for (const suite of data.suites ?? []) {
    walkPlaywrightSuite(suite, failureLines, counts);
  }
  const lines = [heading, ""];
  lines.push(
    `**${counts.passed} passed**, **${counts.failed} failed**, ${counts.skipped} skipped, ${counts.total} total`,
  );
  lines.push("");
  if (counts.failed > 0) {
    lines.push("### Failures", "", ...failureLines);
  }
  return lines;
}

let summaryLines;
if (!existsSync(filePath)) {
  summaryLines = [
    heading,
    "",
    `⚠️ No results file found at \`${filePath}\` — the test run likely crashed before producing output.`,
  ];
} else {
  // A run killed mid-write (job timeout, disk full, reporter crash) leaves a
  // file that exists but doesn't parse, or parses to something that isn't a
  // report. Degrade to a warning rather than throwing — this step runs with
  // `if: always()`, and crashing here would also cost us the other runner's
  // counts.
  let data = null;
  let reason = "";
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
    // Check the shape each summarizer actually reads, not just "is an object":
    // an array or an unrelated object parses fine and then renders a summary
    // full of `undefined` counts, which is worse than saying nothing.
    const shaped =
      kind === "vitest"
        ? typeof data?.numTotalTests === "number"
        : Array.isArray(data?.suites);
    if (!shaped) {
      reason = `parsed to \`${JSON.stringify(data)?.slice(0, 60)}\`, which is not a ${kind} report`;
      data = null;
    }
  } catch (err) {
    reason = `is not valid JSON: ${err.message}`;
  }
  summaryLines = data
    ? kind === "vitest"
      ? summarizeVitest(data)
      : summarizePlaywright(data)
    : [heading, "", `⚠️ Results file at \`${filePath}\` ${reason} — the test run likely crashed mid-write.`];
}

const output = summaryLines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
} else {
  console.log(output);
}
