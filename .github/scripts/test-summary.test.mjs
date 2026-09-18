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
