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

test("push: dev applies prod/account, dev/account, then dev/app; stage stage/account then stage/app; main only prod/app", () => {
  assert.equal(resolve("push", "dev").out, "stacks=prod/account dev/account dev/app");
  assert.equal(resolve("push", "stage").out, "stacks=stage/account stage/app");
  assert.equal(resolve("push", "main").out, "stacks=prod/app");
});

test("push from any other branch fails", () => {
  const r = resolve("push", "feature");
  assert.equal(r.rc, 1);
  assert.match(r.err, /applies only from dev, stage or main/);
});

test("dispatch: a stack runs only from the branch that owns it", () => {
  assert.equal(resolve("workflow_dispatch", "dev", "prod/account").out, "stacks=prod/account");
  assert.equal(resolve("workflow_dispatch", "dev", "dev/account").out, "stacks=dev/account");
  assert.equal(resolve("workflow_dispatch", "dev", "dev/app").out, "stacks=dev/app");
  assert.equal(resolve("workflow_dispatch", "stage", "stage/account").out, "stacks=stage/account");
  assert.equal(resolve("workflow_dispatch", "stage", "stage/app").out, "stacks=stage/app");
  assert.equal(resolve("workflow_dispatch", "main", "prod/app").out, "stacks=prod/app");
  for (const [branch, input] of [
    ["dev", "prod/app"], ["dev", "envs/stage"], ["dev", "envs/dev"], ["stage", "prod/account"], ["stage", "envs/dev"], ["stage", "envs/stage"],
    ["main", "prod/account"], ["main", "envs/dev"], ["dev", "stage/account"], ["main", "stage/account"],
    ["stage", "dev/account"], ["main", "dev/app"], ["dev", "shared"], ["main", "envs/main"],
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

test("plan: prod/account only on PRs into dev", () => {
  assert.equal(run("plan", { BASE: "dev" }).out, "prod/account dev/account dev/app");
  assert.equal(run("plan", { BASE: "stage" }).out, "stage/account stage/app");
  assert.equal(run("plan", { BASE: "main" }).out, "prod/app");
});

test("role: each stack maps to its account's role", () => {
  const prod = "arn:aws:iam::223376380711:role/bgm-looper-tf-apply-prod";
  assert.equal(role("prod/account", "apply").out, prod);
  assert.equal(role("prod/app", "apply").out, prod);
  for (const s of ["prod/account", "prod/app"]) {
    assert.equal(role(s, "plan").out, "arn:aws:iam::223376380711:role/bgm-looper-tf-plan", s);
  }
  assert.equal(role("dev/app", "apply").out, "arn:aws:iam::624586968135:role/bgm-looper-tf-apply");
  assert.equal(role("stage/account", "plan").out, "arn:aws:iam::792682047320:role/bgm-looper-tf-plan");
});

test("role: an unknown stack fails", () => {
  const r = role("bogus", "apply");
  assert.equal(r.rc, 1);
  assert.match(r.err, /::error::no role for bogus/);
});

// envs/dev and envs/stage predate the nonprod accounts (#397); shared, envs/main and
// nonprod/* are the paths before #477 renamed them.
test("role: old stack names have no role", () => {
  for (const s of ["envs/dev", "envs/stage", "shared", "envs/main", "nonprod/dev/account", "nonprod/stage/env"]) {
    for (const mode of ["plan", "apply"]) {
      const r = role(s, mode);
      assert.equal(r.rc, 1, `${s} ${mode}`);
      assert.match(r.err, new RegExp(`::error::no role for ${s}`));
    }
  }
});

test("drift: the branch:stack pairs", () => {
  assert.equal(run("drift", {}).out, "dev:prod/account main:prod/app dev:dev/account dev:dev/app stage:stage/account stage:stage/app");
});
