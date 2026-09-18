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

test("all green renders four rows with ✅ and the Linux-only note", () => {
  const { status, stdout } = run({
    NEEDS: needs({ unit: "success", lambda: "success", e2e: "success", security: "success" }),
    EVENT_NAME: "pull_request",
    BASE_REF: "dev",
  });
  assert.equal(status, 0);
  assert.match(stdout, /^## CI summary\n/);
  assert.match(stdout, /\| Lint \+ unit tests \| ✅ success \|/);
  assert.match(stdout, /\| Lambda tests \| ✅ success \|/);
  assert.match(stdout, /\| E2E \(Playwright\) \| ✅ success \|/);
  assert.match(stdout, /\| Security scan \| ✅ success \|/);
  assert.match(stdout, /Cross-OS e2e: no \(pull_request into dev\)/);
});

test("failure, skipped and cancelled map to ❌ ⏭️ 🚫", () => {
  const { stdout } = run({
    NEEDS: needs({ unit: "failure", lambda: "skipped", e2e: "cancelled", security: "success" }),
    EVENT_NAME: "push",
    BASE_REF: "",
  });
  assert.match(stdout, /\| Lint \+ unit tests \| ❌ failure \|/);
  assert.match(stdout, /\| Lambda tests \| ⏭️ skipped \|/);
  assert.match(stdout, /\| E2E \(Playwright\) \| 🚫 cancelled \|/);
  assert.match(stdout, /Cross-OS e2e: no \(push\)/);
});

test("promotion PR and dispatch say cross-OS ran", () => {
  const base = needs({ unit: "success", lambda: "success", e2e: "success", security: "success" });
  assert.match(run({ NEEDS: base, EVENT_NAME: "pull_request", BASE_REF: "stage" }).stdout, /Cross-OS e2e: yes \(pull_request into stage\)/);
  assert.match(run({ NEEDS: base, EVENT_NAME: "workflow_dispatch", BASE_REF: "" }).stdout, /Cross-OS e2e: yes \(workflow_dispatch\)/);
});

test("unknown jobs are listed by id so a renamed job is not silently dropped", () => {
  const { stdout } = run({
    NEEDS: needs({ unit: "success", lambda: "success", e2e: "success", security: "success", chromatic: "success" }),
    EVENT_NAME: "push",
    BASE_REF: "",
  });
  assert.match(stdout, /\| chromatic \| ✅ success \|/);
});

test("bad NEEDS exits 1", () => {
  assert.equal(run({ NEEDS: "not json", EVENT_NAME: "push", BASE_REF: "" }).status, 1);
});
