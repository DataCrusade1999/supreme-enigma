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

test("all green renders one row per job with ✅", () => {
  const { status, stdout } = run({
    NEEDS: needs({ test: "success", "e2e-cross-os": "success", chromatic: "skipped" }),
    EVENT_NAME: "pull_request",
    BASE_REF: "main",
  });
  assert.equal(status, 0);
  assert.match(stdout, /^## CI summary\n/);
  assert.match(stdout, /\| Tests \(lint, unit, Lambda, e2e, security\) \| ✅ success \|/);
  assert.match(stdout, /\| E2E \(Windows, macOS\) \| ✅ success \|/);
});

test("failure, skipped and cancelled map to ❌ ⏭️ 🚫", () => {
  const { stdout } = run({
    NEEDS: needs({ test: "failure", "e2e-cross-os": "cancelled", chromatic: "skipped" }),
    EVENT_NAME: "pull_request",
    BASE_REF: "main",
  });
  assert.match(stdout, /\| Tests \(lint, unit, Lambda, e2e, security\) \| ❌ failure \|/);
  assert.match(stdout, /\| E2E \(Windows, macOS\) \| 🚫 cancelled \|/);
  assert.match(stdout, /\| chromatic \| ⏭️ skipped \|/);
});

test("cross-OS e2e runs on PRs into main only", () => {
  const base = needs({ test: "success", "e2e-cross-os": "success" });
  assert.match(run({ NEEDS: base, EVENT_NAME: "pull_request", BASE_REF: "main" }).stdout, /Cross-OS e2e: yes \(pull_request into main\)/);
  assert.match(run({ NEEDS: base, EVENT_NAME: "pull_request", BASE_REF: "stage" }).stdout, /Cross-OS e2e: no \(pull_request into stage\)/);
  assert.match(run({ NEEDS: base, EVENT_NAME: "workflow_dispatch", BASE_REF: "" }).stdout, /Cross-OS e2e: no \(workflow_dispatch\)/);
});

test("unknown jobs are listed by id so a renamed job is not silently dropped", () => {
  const { stdout } = run({
    NEEDS: needs({ test: "success", "some-new-job": "success" }),
    EVENT_NAME: "push",
    BASE_REF: "",
  });
  assert.match(stdout, /\| some-new-job \| ✅ success \|/);
});

test("bad NEEDS exits 1", () => {
  assert.equal(run({ NEEDS: "not json", EVENT_NAME: "push", BASE_REF: "" }).status, 1);
});
