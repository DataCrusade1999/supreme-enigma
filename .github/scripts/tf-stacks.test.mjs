import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./tf-stacks.sh", import.meta.url));
const run = (mode, env) => {
  const r = spawnSync("bash", [script, mode], { env: { ...process.env, ...env }, encoding: "utf8" });
  // err is stderr only: stdout is $GITHUB_OUTPUT, where an ::error:: line is silently dropped.
  return { rc: r.status, out: r.stdout.trim(), err: r.stderr };
};
const role = (stack, mode) => {
  const r = spawnSync("bash", [script, "role", stack, mode], { env: process.env, encoding: "utf8" });
  return { rc: r.status, out: r.stdout.trim(), err: r.stderr };
};
const resolve = (EVENT, BRANCH, INPUT = "") => run("resolve", { EVENT, BRANCH, INPUT });

test("push: dev applies shared, envs/dev, then nonprod/dev/account; stage and main only their own env", () => {
  assert.equal(resolve("push", "dev").out, "stacks=shared envs/dev nonprod/dev/account");
  assert.equal(resolve("push", "stage").out, "stacks=envs/stage");
  assert.equal(resolve("push", "main").out, "stacks=envs/main");
});

test("push from any other branch fails", () => {
  const r = resolve("push", "feature");
  assert.equal(r.rc, 1);
  assert.match(r.err, /applies only from dev, stage or main/);
});

test("dispatch: a stack runs only from the branch that owns it", () => {
  assert.equal(resolve("workflow_dispatch", "dev", "shared").out, "stacks=shared");
  assert.equal(resolve("workflow_dispatch", "dev", "envs/dev").out, "stacks=envs/dev");
  assert.equal(resolve("workflow_dispatch", "dev", "nonprod/dev/account").out, "stacks=nonprod/dev/account");
  assert.equal(resolve("workflow_dispatch", "stage", "envs/stage").out, "stacks=envs/stage");
  assert.equal(resolve("workflow_dispatch", "main", "envs/main").out, "stacks=envs/main");
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
    const r = resolve("workflow_dispatch", branch, "");
    assert.equal(r.rc, 1, branch);
    assert.match(r.err, /::error::/, branch);
  }
});

test("plan: shared only on PRs into dev", () => {
  assert.equal(run("plan", { BASE: "dev" }).out, "shared envs/dev nonprod/dev/account");
  assert.equal(run("plan", { BASE: "stage" }).out, "envs/stage");
  assert.equal(run("plan", { BASE: "main" }).out, "envs/main");
});

test("role: each stack maps to its account's role", () => {
  const prod = "arn:aws:iam::223376380711:role/bgm-looper-tf-apply-prod";
  const nonprod = "arn:aws:iam::223376380711:role/bgm-looper-tf-apply-nonprod";
  assert.equal(role("shared", "apply").out, prod);
  assert.equal(role("envs/main", "apply").out, prod);
  assert.equal(role("envs/dev", "apply").out, nonprod);
  assert.equal(role("envs/stage", "apply").out, nonprod);
  for (const s of ["shared", "envs/dev", "envs/stage", "envs/main"]) {
    assert.equal(role(s, "plan").out, "arn:aws:iam::223376380711:role/bgm-looper-tf-plan", s);
  }
  assert.equal(role("nonprod/dev/env", "apply").out, "arn:aws:iam::624586968135:role/bgm-looper-tf-apply");
  assert.equal(role("nonprod/stage/account", "plan").out, "arn:aws:iam::792682047320:role/bgm-looper-tf-plan");
});

test("role: an unknown stack fails", () => {
  const r = role("bogus", "apply");
  assert.equal(r.rc, 1);
  assert.match(r.err, /::error::no role for bogus/);
});

test("drift: the branch:stack pairs", () => {
  assert.equal(run("drift", {}).out, "dev:shared stage:envs/stage dev:envs/dev main:envs/main dev:nonprod/dev/account");
});
