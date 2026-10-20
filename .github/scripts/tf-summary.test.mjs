import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarize, renderComment, readStacks, guardLines, MAX_COMMENT } from "./tf-summary.mjs";

const rc = (address, actions) => ({ address, change: { actions } });
const plan = (...changes) => ({ resource_changes: changes });

test("no changes: no-op and read are ignored", () => {
  const s = summarize(plan(rc("a.x", ["no-op"]), rc("data.b.y", ["read"])));
  assert.deepEqual(s, { add: 0, change: 0, destroy: 0, forget: 0, replace: [], deletes: [], forgets: [] });
});

test("a plan with no resource_changes key is no changes", () => {
  assert.deepEqual(summarize({}), { add: 0, change: 0, destroy: 0, forget: 0, replace: [], deletes: [], forgets: [] });
});

test("create, update and delete are counted like terraform's Plan: line", () => {
  const s = summarize(plan(rc("a.new", ["create"]), rc("a.upd", ["update"]), rc("a.gone", ["delete"])));
  assert.equal(s.add, 1);
  assert.equal(s.change, 1);
  assert.equal(s.destroy, 1);
  assert.deepEqual(s.deletes, ["a.gone"]);
});

test("both replace orders count as one add, one destroy and a delete", () => {
  const s = summarize(plan(rc("a.r1", ["delete", "create"]), rc("a.r2", ["create", "delete"])));
  assert.equal(s.add, 2);
  assert.equal(s.destroy, 2);
  assert.deepEqual(s.replace, ["a.r1", "a.r2"]);
  assert.deepEqual(s.deletes, ["a.r1", "a.r2"]);
});

test("comment: marker first, No changes stack, counts, warning only when deleting", () => {
  const md = renderComment(
    [
      { name: "shared", plan: plan(rc("a.x", ["no-op"])), text: "No changes." },
      { name: "envs/dev", plan: plan(rc("a.r", ["delete", "create"]), rc("a.n", ["create"])), text: "plan text" },
    ],
    "PR plan",
  );
  assert.equal(md.split("\n")[0], "<!-- terraform-plan -->");
  assert.match(md, /### `shared` — No changes/);
  assert.match(md, /### `envs\/dev` — 2 to add, 0 to change, 1 to destroy/);
  assert.match(md, /⚠ destroys or replaces: `a\.r`/);
  assert.equal((md.match(/⚠/g) ?? []).length, 1);
  assert.match(md, /<details>[\s\S]*plan text[\s\S]*<\/details>/);
});

test("comment: plan text containing ``` cannot close the fence early", () => {
  const md = renderComment([{ name: "shared", plan: plan(rc("a", ["update"])), text: "x\n```\ny" }], "t");
  assert.match(md, /````\n/);
});

test("forget (a removed block) counts toward the guard but is named as a forget, not a destroy", () => {
  const s = summarize(plan(rc("a.f", ["forget"])));
  assert.equal(s.forget, 1);
  assert.deepEqual(s.deletes, ["a.f"]);
  assert.deepEqual(s.forgets, ["a.f"]);
  const md = renderComment([{ name: "shared", plan: plan(rc("a.f", ["forget"])), text: "t" }], "t");
  assert.match(md, /### `shared` — 0 to add, 0 to change, 0 to destroy, 1 to forget/);
  assert.match(md, /⚠ forgets \(drops from state, does not destroy\): `a\.f`/);
  assert.doesNotMatch(md, /destroys or replaces/);
});

test("a plan that destroys one resource and forgets another lists each on its own line", () => {
  const md = renderComment([{ name: "shared", plan: plan(rc("a.gone", ["delete"]), rc("a.f", ["forget"])), text: "t" }], "t");
  assert.match(md, /⚠ destroys or replaces: `a\.gone`\n/);
  assert.match(md, /⚠ forgets \(drops from state, does not destroy\): `a\.f`\n/);
});

test("guardLines marks forgets so the apply job's list doesn't read as deletions", () => {
  const s = summarize(plan(rc("a.gone", ["delete"]), rc("a.f", ["forget"])));
  assert.deepEqual(guardLines(s), ["- `a.gone`", "- `a.f` (forget: drops from state, does not destroy)"]);
});

test("readStacks names each stack by its directory under plans/, hyphens and all", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-summary-"));
  for (const stack of ["shared", "envs/dev", "envs/dev-east"]) {
    mkdirSync(join(dir, stack), { recursive: true });
    writeFileSync(join(dir, stack, "plan.json"), JSON.stringify(plan(rc("a", ["update"]))));
    writeFileSync(join(dir, stack, "plan.txt"), `text of ${stack}`);
  }
  const stacks = readStacks(dir);
  assert.deepEqual(stacks.map((s) => s.name), ["envs/dev", "envs/dev-east", "shared"]);
  assert.equal(stacks[1].text, "text of envs/dev-east");
});

test("comment: a long plan never pushes a later stack's heading or ⚠ line out", () => {
  const md = renderComment(
    [
      { name: "envs/dev", plan: plan(rc("a", ["update"])), text: "z".repeat(200000) },
      { name: "shared", plan: plan(rc("aws_iam_role.gone", ["delete"])), text: "gone" },
    ],
    "t",
  );
  assert.ok(md.length <= MAX_COMMENT, `length ${md.length}`);
  assert.match(md, /### `shared` — 0 to add, 0 to change, 1 to destroy/);
  assert.match(md, /⚠ destroys or replaces: `aws_iam_role\.gone`/);
  assert.match(md, /truncated — the full plan is in the job summary/);
  assert.equal((md.match(/<details>/g) ?? []).length, (md.match(/<\/details>/g) ?? []).length);
});

test("comment: truncation closes the open fence and </details>, and keeps the note outside them", () => {
  const text = "x\n```\ny\n" + "z".repeat(200000);
  const md = renderComment([{ name: "shared", plan: plan(rc("a", ["update"])), text }], "t");
  assert.ok(md.length <= MAX_COMMENT, `length ${md.length}`);
  const fences = md.split("\n").filter((l) => /^`{3,}$/.test(l));
  // The middle ``` is plan text; the outer pair is the 4-tick fence, opened and closed.
  assert.deepEqual([fences[0], fences.at(-1), fences.length], ["````", "````", 3]);
  assert.equal((md.match(/<details>/g) ?? []).length, (md.match(/<\/details>/g) ?? []).length);
  assert.ok(md.lastIndexOf("</details>") < md.indexOf("truncated —"));
});

test("comment: truncation in a later stack keeps the earlier stacks whole", () => {
  const md = renderComment(
    [
      { name: "envs/dev", plan: plan(rc("a", ["update"])), text: "small plan" },
      { name: "shared", plan: plan(rc("b", ["update"])), text: "z".repeat(200000) },
    ],
    "t",
  );
  assert.ok(md.length <= MAX_COMMENT, `length ${md.length}`);
  assert.match(md, /small plan/);
  assert.match(md, /### `shared` — 0 to add, 1 to change/);
  assert.equal((md.match(/<details>/g) ?? []).length, (md.match(/<\/details>/g) ?? []).length);
});

test("comment: truncated under GitHub's limit with a pointer to the job summary", () => {
  const md = renderComment([{ name: "shared", plan: plan(rc("a", ["update"])), text: "z".repeat(200000) }], "t");
  assert.ok(md.length <= MAX_COMMENT, `length ${md.length}`);
  assert.match(md, /truncated — the full plan is in the job summary/);
});

test("comment: a large first plan leaves a later small plan whole", () => {
  const md = renderComment(
    [
      { name: "envs/dev", plan: plan(rc("a", ["update"])), text: "z".repeat(200000) },
      { name: "shared", plan: plan(rc("b", ["update"])), text: "small plan" },
    ],
    "t",
  );
  assert.ok(md.length <= MAX_COMMENT, `length ${md.length}`);
  assert.match(md, /small plan/);
  assert.ok(md.indexOf("envs/dev") < md.indexOf("shared"), "stacks keep their order");
  assert.match(md, /truncated — the full plan is in the job summary/);
});
