import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./tf-stacks.sh", import.meta.url));
const run = (mode, env) => {
  const r = spawnSync("bash", [script, mode], { env: { ...process.env, ...env }, encoding: "utf8" });
  return { rc: r.status, out: r.stdout.trim(), err: r.stderr + r.stdout };
};
const resolve = (EVENT, BRANCH, INPUT = "") => run("resolve", { EVENT, BRANCH, INPUT });

test("push: dev applies shared then envs/dev; stage and main only their own env", () => {
  assert.equal(resolve("push", "dev").out, "shared=shared\nenv=envs/dev\nrole=apply-nonprod");
  assert.equal(resolve("push", "stage").out, "shared=\nenv=envs/stage\nrole=apply-nonprod");
  assert.equal(resolve("push", "main").out, "shared=\nenv=envs/main\nrole=apply-prod");
});

test("push from any other branch fails", () => {
  const r = resolve("push", "feature");
  assert.equal(r.rc, 1);
  assert.match(r.err, /applies only from dev, stage or main/);
});

test("dispatch: a stack runs only from the branch that owns it", () => {
  assert.equal(resolve("workflow_dispatch", "dev", "shared").out, "shared=shared\nenv=\nrole=apply-nonprod");
  assert.equal(resolve("workflow_dispatch", "dev", "envs/dev").out, "shared=\nenv=envs/dev\nrole=apply-nonprod");
  assert.equal(resolve("workflow_dispatch", "stage", "envs/stage").out, "shared=\nenv=envs/stage\nrole=apply-nonprod");
  assert.equal(resolve("workflow_dispatch", "main", "envs/main").out, "shared=\nenv=envs/main\nrole=apply-prod");
  for (const [branch, input] of [
    ["dev", "envs/main"], ["dev", "envs/stage"], ["stage", "shared"], ["stage", "envs/dev"],
    ["main", "shared"], ["main", "envs/dev"],
  ]) {
    const r = resolve("workflow_dispatch", branch, input);
    assert.equal(r.rc, 1, `${input} on ${branch}`);
    assert.match(r.err, new RegExp(`${input} is not applied from ${branch}`));
  }
});

test("dispatch with an empty stack fails on every branch", () => {
  for (const branch of ["dev", "stage", "main"]) {
    assert.equal(resolve("workflow_dispatch", branch, "").rc, 1, branch);
  }
});

test("plan: shared only on PRs into dev", () => {
  assert.equal(run("plan", { BASE: "dev" }).out, "shared envs/dev");
  assert.equal(run("plan", { BASE: "stage" }).out, "envs/stage");
  assert.equal(run("plan", { BASE: "main" }).out, "envs/main");
});
