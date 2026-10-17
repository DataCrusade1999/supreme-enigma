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

test("push: dev applies shared, nonprod/dev/account, then nonprod/dev/env; stage nonprod/stage/account then nonprod/stage/env; main only its own env", () => {
  assert.equal(resolve("push", "dev").out, "stacks=shared nonprod/dev/account nonprod/dev/env");
  assert.equal(resolve("push", "stage").out, "stacks=nonprod/stage/account nonprod/stage/env");
  assert.equal(resolve("push", "main").out, "stacks=envs/main");
});

test("push from any other branch fails", () => {
  const r = resolve("push", "feature");
  assert.equal(r.rc, 1);
  assert.match(r.err, /applies only from dev, stage or main/);
});

test("dispatch: a stack runs only from the branch that owns it", () => {
  assert.equal(resolve("workflow_dispatch", "dev", "shared").out, "stacks=shared");
  assert.equal(resolve("workflow_dispatch", "dev", "nonprod/dev/account").out, "stacks=nonprod/dev/account");
  assert.equal(resolve("workflow_dispatch", "dev", "nonprod/dev/env").out, "stacks=nonprod/dev/env");
  assert.equal(resolve("workflow_dispatch", "stage", "nonprod/stage/account").out, "stacks=nonprod/stage/account");
  assert.equal(resolve("workflow_dispatch", "stage", "nonprod/stage/env").out, "stacks=nonprod/stage/env");
  assert.equal(resolve("workflow_dispatch", "main", "envs/main").out, "stacks=envs/main");
  for (const [branch, input] of [
    ["dev", "envs/main"], ["dev", "envs/stage"], ["dev", "envs/dev"], ["stage", "shared"], ["stage", "envs/dev"], ["stage", "envs/stage"],
    ["main", "shared"], ["main", "envs/dev"], ["dev", "nonprod/stage/account"], ["main", "nonprod/stage/account"],
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
  assert.equal(run("plan", { BASE: "dev" }).out, "shared nonprod/dev/account nonprod/dev/env");
  assert.equal(run("plan", { BASE: "stage" }).out, "nonprod/stage/account nonprod/stage/env");
  assert.equal(run("plan", { BASE: "main" }).out, "envs/main");
});

test("role: each stack maps to its account's role", () => {
  const prod = "arn:aws:iam::223376380711:role/bgm-looper-tf-apply-prod";
  assert.equal(role("shared", "apply").out, prod);
  assert.equal(role("envs/main", "apply").out, prod);
  for (const s of ["shared", "envs/main"]) {
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

test("role: the legacy envs/dev and envs/stage stacks have no role", () => {
  for (const s of ["envs/dev", "envs/stage"]) {
    for (const mode of ["plan", "apply"]) {
      const r = role(s, mode);
      assert.equal(r.rc, 1, `${s} ${mode}`);
      assert.match(r.err, new RegExp(`::error::no role for ${s}`));
    }
  }
});

test("drift: the branch:stack pairs", () => {
  assert.equal(run("drift", {}).out, "dev:shared main:envs/main dev:nonprod/dev/account dev:nonprod/dev/env stage:nonprod/stage/account stage:nonprod/stage/env");
});
