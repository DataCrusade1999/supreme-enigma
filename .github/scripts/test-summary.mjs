import { readFileSync, appendFileSync, existsSync } from "node:fs";

const [, , flag, kind, filePath] = process.argv;
if (flag !== "--kind" || (kind !== "vitest" && kind !== "playwright") || !filePath) {
  console.error("Usage: node test-summary.mjs --kind <vitest|playwright> <results-file>");
  process.exit(1);
}

function summarizeVitest(data) {
  const lines = ["## Unit tests (Vitest)", ""];
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
        lines.push("```", (assertion.failureMessages || []).join("\n\n"), "```", "</details>", "");
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
          failureLines.push(
            `<details><summary>❌ ${spec.title} (${spec.file})</summary>`,
            "",
            "```",
            result.error?.message ?? "no error message captured",
            "```",
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
  const lines = ["## E2E + accessibility tests (Playwright)", ""];
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
    kind === "vitest" ? "## Unit tests (Vitest)" : "## E2E + accessibility tests (Playwright)",
    "",
    `⚠️ No results file found at \`${filePath}\` — the test run likely crashed before producing output.`,
  ];
} else {
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  summaryLines = kind === "vitest" ? summarizeVitest(data) : summarizePlaywright(data);
}

const output = summaryLines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
} else {
  console.log(output);
}
