// Shared by the four summary renderers. Everything here was duplicated across
// at least two of them before e2e-summary.mjs made it four.
import { appendFileSync } from "node:fs";

export const ICONS = {
  success: "✅",
  failure: "❌",
  skipped: "⏭️",
  cancelled: "🚫",
  flaky: "⚠️",
};

// A failure message can itself contain a ``` block (a Vitest diff of MDX or
// markdown content, say), which would close the wrapping fence early and
// corrupt every entry after it. Wrap in one more backtick than the longest
// run appearing inside the body.
export function fence(body) {
  const longest = Math.max(0, ...(String(body).match(/`+/g) ?? []).map((m) => m.length));
  return "`".repeat(Math.max(3, longest + 1));
}

// Playwright's reporter colours its assertion diffs, so error.message arrives
// with CSI escapes around every highlighted token. GitHub renders none of
// that - they show up as literal `[31m` noise wrapped around each failure.
const ANSI = new RegExp(
  `[${String.fromCharCode(0x1b)}${String.fromCharCode(0x9b)}][[()#;?]*` +
    "(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><]",
  "g",
);
export function stripAnsi(s) {
  return String(s).replace(ANSI, "");
}

// A markdown link to the file at the commit under test, or plain code when we
// are not on a runner (the *.test.mjs suites, or a local render). HEAD_SHA is
// passed in by the workflow as `pull_request.head.sha || github.sha`: on a
// pull_request event github.sha is the synthetic merge commit, whose blob URLs
// are not reachable from the PR.
export function blobLink(path, line) {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.HEAD_SHA;
  const label = line ? `${path}:${line}` : path;
  if (!server || !repo || !sha) return `\`${label}\``;
  const anchor = line ? `#L${line}` : "";
  return `[\`${label}\`](${server}/${repo}/blob/${sha}/${path}${anchor})`;
}

export function formatDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "–";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

// GITHUB_STEP_SUMMARY is set to "" by the test suites, which is falsy, so a
// local run prints instead of trying to append to a file named "".
// Terminates with a blank line, not just a newline: the `summary` job appends
// two summaries to the same $GITHUB_STEP_SUMMARY, and without it the second
// one's `##` heading lands directly under the first one's closing paragraph.
export function emit(lines) {
  const output = lines.join("\n").replace(/\n+$/, "") + "\n\n";
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
  } else {
    console.log(output);
  }
  return output;
}
