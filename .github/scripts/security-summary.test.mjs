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
