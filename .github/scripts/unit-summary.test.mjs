import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = fileURLToPath(new URL("./unit-summary.mjs", import.meta.url));

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: "",
      GITHUB_WORKSPACE: "/work/repo",
      GITHUB_SERVER_URL: "",
      GITHUB_REPOSITORY: "",
      HEAD_SHA: "",
      ...env,
    },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function tmpJson(value) {
  const file = join(mkdtempSync(join(tmpdir(), "unit-")), "vitest.json");
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

function report({ passed = 2, failed = 0, pending = 0, failures = [] } = {}) {
  return {
    numTotalTests: passed + failed + pending,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: pending,
    startTime: 1000,
    testResults: [
      {
        name: "/work/repo/web/lib/auth.test.ts",
        startTime: 1200,
        endTime: 13_400,
        status: failed ? "failed" : "passed",
        assertionResults: [
          { fullName: "auth hashes", title: "hashes", status: "passed", duration: 120, failureMessages: [] },
          { fullName: "auth compares", title: "compares", status: "passed", duration: 4200, failureMessages: [] },
          ...failures,
        ],
      },
    ],
  };
}

test("counts render as a table with a duration", () => {
  const { status, stdout } = run([tmpJson(report())]);
  assert.equal(status, 0);
  assert.match(stdout, /^## Unit tests \(Vitest\)\n/);
  assert.match(stdout, /\| ✅ Passed \| ❌ Failed \| ⏭️ Skipped \| Total \| Duration \|/);
  // startTime 1000 -> endTime 13400 is 12.4s of wall clock.
  assert.match(stdout, /\| 2 \| 0 \| 0 \| 2 \| 12\.4s \|/);
});

test("the slowest-tests table is collapsed and ordered", () => {
  const { stdout } = run([tmpJson(report())]);
  assert.match(stdout, /<details><summary>Slowest tests<\/summary>/);
  const slow = stdout.indexOf("auth compares");
  const fast = stdout.indexOf("auth hashes");
  assert.ok(slow > -1 && fast > -1 && slow < fast, "slowest test must come first");
});

test("failures are grouped under a repo-relative file heading", () => {
  const failures = [
    { fullName: "auth rejects", title: "rejects", status: "failed", duration: 3, failureMessages: ["AssertionError: nope"] },
    { fullName: "auth expires", title: "expires", status: "failed", duration: 4, failureMessages: ["AssertionError: also nope"] },
  ];
  const { stdout } = run([tmpJson(report({ passed: 2, failed: 2, failures }))]);
  assert.match(stdout, /### Failures/);
  assert.match(stdout, /#### `web\/lib\/auth\.test\.ts` — 2 failed/);
  assert.match(stdout, /<details><summary>❌ auth rejects<\/summary>/);
  assert.match(stdout, /AssertionError: also nope/);
});

test("failure file headings link to the blob when the runner env is present", () => {
  const failures = [
    { fullName: "auth rejects", title: "rejects", status: "failed", duration: 3, failureMessages: ["boom"] },
  ];
  const { stdout } = run([tmpJson(report({ passed: 2, failed: 1, failures }))], {
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "o/r",
    HEAD_SHA: "abc123",
  });
  assert.match(
    stdout,
    /#### \[`web\/lib\/auth\.test\.ts`\]\(https:\/\/github\.com\/o\/r\/blob\/abc123\/web\/lib\/auth\.test\.ts\)/,
  );
});

test("a failure message containing a fence does not break the block", () => {
  const failures = [
    { fullName: "mdx renders", title: "renders", status: "failed", duration: 1, failureMessages: ["diff:\n```\nfoo\n```"] },
  ];
  const { stdout } = run([tmpJson(report({ passed: 2, failed: 1, failures }))]);
  assert.match(stdout, /^````$/m);
});

test("no failures means no Failures section", () => {
  const { stdout } = run([tmpJson(report())]);
  assert.doesNotMatch(stdout, /### Failures/);
});

test("missing file degrades to a warning, not a crash", () => {
  const { status, stdout } = run(["/nope/none.json"]);
  assert.equal(status, 0);
  assert.match(stdout, /^## Unit tests \(Vitest\)\n/);
  assert.match(stdout, /No results file found/);
});

test("malformed JSON degrades to a warning", () => {
  const { status, stdout } = run([tmpJson("{ not json")]);
  assert.equal(status, 0);
  assert.match(stdout, /is not valid JSON/);
});

test("JSON of the wrong shape degrades to a warning rather than undefined counts", () => {
  const { status, stdout } = run([tmpJson([1, 2, 3])]);
  assert.equal(status, 0);
  assert.match(stdout, /is not a vitest report/);
  assert.doesNotMatch(stdout, /undefined/);
});

test("usage error without a file argument", () => {
  assert.equal(run([]).status, 1);
});
