import { test } from "node:test";
import assert from "node:assert/strict";
import { fence, stripAnsi, blobLink, formatDuration, ICONS, emit } from "./summary-lib.mjs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ESC = String.fromCharCode(27);

test("fence escalates past the longest backtick run in the body", () => {
  assert.equal(fence("nothing special"), "```");
  assert.equal(fence("a ``` b"), "````");
  assert.equal(fence("a ````` b"), "``````");
});

test("stripAnsi removes the escapes Playwright puts in error.message", () => {
  const msg = `Error: ${ESC}[2mexpect(${ESC}[22m${ESC}[31mreceived${ESC}[39m${ESC}[2m)${ESC}[22m`;
  assert.equal(stripAnsi(msg), "Error: expect(received)");
});

test("stripAnsi leaves ordinary text alone", () => {
  assert.equal(stripAnsi("plain [31m not an escape"), "plain [31m not an escape");
});

test("blobLink degrades to plain code when the runner env is absent", () => {
  const saved = { ...process.env };
  delete process.env.GITHUB_SERVER_URL;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.HEAD_SHA;
  assert.equal(blobLink("web/e2e/a.spec.ts", 12), "`web/e2e/a.spec.ts:12`");
  assert.equal(blobLink("web/lib/auth.test.ts"), "`web/lib/auth.test.ts`");
  process.env = saved;
});

test("blobLink anchors the line only when it has one", () => {
  const saved = { ...process.env };
  process.env.GITHUB_SERVER_URL = "https://github.com";
  process.env.GITHUB_REPOSITORY = "o/r";
  process.env.HEAD_SHA = "abc123";
  assert.equal(
    blobLink("web/e2e/a.spec.ts", 12),
    "[`web/e2e/a.spec.ts:12`](https://github.com/o/r/blob/abc123/web/e2e/a.spec.ts#L12)",
  );
  assert.equal(
    blobLink("web/lib/auth.test.ts"),
    "[`web/lib/auth.test.ts`](https://github.com/o/r/blob/abc123/web/lib/auth.test.ts)",
  );
  process.env = saved;
});

test("formatDuration switches unit at each boundary", () => {
  assert.equal(formatDuration(840), "840ms");
  assert.equal(formatDuration(999), "999ms");
  assert.equal(formatDuration(1000), "1.0s");
  assert.equal(formatDuration(12_400), "12.4s");
  assert.equal(formatDuration(59_999), "60.0s");
  assert.equal(formatDuration(107_000), "1m 47s");
  assert.equal(formatDuration(75_000), "1m 15s");
});

test("formatDuration returns a dash for anything that is not a duration", () => {
  assert.equal(formatDuration(undefined), "–");
  assert.equal(formatDuration(NaN), "–");
  assert.equal(formatDuration(-1), "–");
});

test("ICONS covers every job result the rollup can see", () => {
  for (const key of ["success", "failure", "skipped", "cancelled", "flaky"]) {
    assert.ok(ICONS[key], `missing icon for ${key}`);
  }
});

// The `summary` job appends two summaries to the same file. Without a blank
// line between them the second `##` heading sits under the first's closing
// paragraph, which is what the cross-OS run actually rendered.
test("emit separates consecutive summaries with a blank line", () => {
  const file = join(mkdtempSync(join(tmpdir(), "emit-")), "step.md");
  writeFileSync(file, "");
  const saved = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = file;
  emit(["## CI summary", "", "Cross-OS e2e: no."]);
  emit(["## E2E + accessibility tests (Playwright)", "", "43 passed."]);
  if (saved === undefined) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = saved;
  const written = readFileSync(file, "utf8");
  assert.equal(written, "## CI summary\n\nCross-OS e2e: no.\n\n## E2E + accessibility tests (Playwright)\n\n43 passed.\n\n");
});

test("emit collapses trailing blank lines rather than stacking them", () => {
  const saved = process.env.GITHUB_STEP_SUMMARY;
  delete process.env.GITHUB_STEP_SUMMARY;
  const out = emit(["## Heading", "", "body", "", ""]);
  if (saved !== undefined) process.env.GITHUB_STEP_SUMMARY = saved;
  assert.equal(out, "## Heading\n\nbody\n\n");
});
