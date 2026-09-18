import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = fileURLToPath(new URL("./e2e-summary.mjs", import.meta.url));
const ESC = String.fromCharCode(27);

function run(dir, env = {}) {
  const r = spawnSync(process.execPath, [script, dir], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: "",
      GITHUB_SERVER_URL: "",
      GITHUB_REPOSITORY: "",
      HEAD_SHA: "",
      ...env,
    },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function spec(file, line, title, status, duration, errorMessage) {
  const result = { status: status === "unexpected" ? "failed" : status, duration, retry: 0 };
  if (errorMessage) result.error = { message: errorMessage, stack: errorMessage };
  return { title, file, line, column: 1, ok: status === "expected", tests: [{ status, results: [result] }] };
}

// Two top-level suites and one nested suite, so the walker's recursion is
// exercised rather than assumed.
function report(specs, stats) {
  return {
    // Playwright sets rootDir to the project testDir, not to the directory
    // holding playwright.config.ts. Real value from a CI artifact.
    config: { rootDir: "/home/runner/work/supreme-enigma/supreme-enigma/web/e2e" },
    errors: [],
    stats,
    suites: [
      { title: "a11y.spec.ts", file: "a11y.spec.ts", specs: [specs[0]], suites: [] },
      {
        title: "pages.spec.ts",
        file: "pages.spec.ts",
        specs: [specs[1]],
        suites: [{ title: "nested", file: "pages.spec.ts", specs: [specs[2]], suites: [] }],
      },
    ],
  };
}

const PASSING = [
  spec("a11y.spec.ts", 4, "home has no violations", "expected", 3100),
  spec("pages.spec.ts", 6, "about renders", "expected", 900),
  spec("pages.spec.ts", 15, "resume renders", "skipped", 0),
];
const PASSING_STATS = { duration: 107_000, expected: 2, unexpected: 0, skipped: 1, flaky: 0 };

function download(legs) {
  const root = mkdtempSync(join(tmpdir(), "e2e-"));
  for (const [os, content] of Object.entries(legs)) {
    const dir = join(root, `playwright-results-${os}`);
    mkdirSync(dir, { recursive: true });
    if (content === null) continue; // artifact with no results file
    writeFileSync(join(dir, "playwright-results.json"), typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

test("one leg renders a one-column table", () => {
  const { status, stdout } = run(download({ Linux: report(PASSING, PASSING_STATS) }));
  assert.equal(status, 0);
  assert.match(stdout, /^## E2E \+ accessibility tests \(Playwright\)\n/);
  assert.match(stdout, /\| Spec \| 🐧 Linux \|/);
  assert.doesNotMatch(stdout, /Windows/);
  assert.match(stdout, /across 1 runner\./);
  assert.match(stdout, /\| \*\*Duration\*\* \| 1m 47s \|/);
});

test("three legs render three columns in matrix order", () => {
  const root = download({
    macOS: report(PASSING, { ...PASSING_STATS, duration: 75_000 }),
    Linux: report(PASSING, PASSING_STATS),
    Windows: report(PASSING, { ...PASSING_STATS, duration: 423_000 }),
  });
  const { stdout } = run(root);
  assert.match(stdout, /\| Spec \| 🐧 Linux \| 🪟 Windows \| 🍎 macOS \|/);
  assert.match(stdout, /\| \*\*Duration\*\* \| 1m 47s \| 7m 03s \| 1m 15s \|/);
  assert.match(stdout, /across 3 runners\./);
});

test("a spec failing on one OS only shows per-column and groups the failure under that OS", () => {
  const failMsg = `Error: ${ESC}[31mreceived${ESC}[39m did not match`;
  const winSpecs = [
    PASSING[0],
    spec("pages.spec.ts", 6, "about renders", "unexpected", 12_400, failMsg),
    PASSING[2],
  ];
  const root = download({
    Linux: report(PASSING, PASSING_STATS),
    Windows: report(winSpecs, { duration: 423_000, expected: 1, unexpected: 1, skipped: 1, flaky: 0 }),
  });
  const { stdout } = run(root);
  assert.match(stdout, /\| `web\/e2e\/pages\.spec\.ts` \| ✅ 1 \| ❌ 1\/2 \|/);
  assert.match(stdout, /\| \*\*Total\*\* \| \*\*✅ 2\*\* \| \*\*❌ 1\/3\*\* \|/);
  assert.match(stdout, /#### 🪟 Windows/);
  assert.match(stdout, /<details><summary>❌ about renders — web\/e2e\/pages\.spec\.ts<\/summary>/);
  // ANSI stripped, not passed through.
  assert.match(stdout, /Error: received did not match/);
  assert.doesNotMatch(stdout, /\[31m/);
});

test("a flaky test is reported as flaky, not as a pass and a failure", () => {
  const flakySpec = {
    title: "retried once",
    file: "pages.spec.ts",
    line: 6,
    column: 1,
    ok: true,
    tests: [
      {
        status: "flaky",
        results: [
          { status: "failed", duration: 900, retry: 0, error: { message: "first attempt" } },
          { status: "passed", duration: 800, retry: 1 },
        ],
      },
    ],
  };
  const root = download({
    Linux: report([PASSING[0], flakySpec, PASSING[2]], { duration: 1000, expected: 1, unexpected: 0, skipped: 1, flaky: 1 }),
  });
  const { stdout } = run(root);
  assert.match(stdout, /⚠️ 1\/2/);
  assert.match(stdout, /\| \*\*Total\*\* \| \*\*⚠️ 1\/3\*\* \|/);
  assert.doesNotMatch(stdout, /### Failures/);
});

test("skipped-only spec renders the skip icon", () => {
  const root = download({
    Linux: report(
      [spec("a11y.spec.ts", 4, "skipped one", "skipped", 0), PASSING[1], PASSING[2]],
      { duration: 1000, expected: 1, unexpected: 0, skipped: 2, flaky: 0 },
    ),
  });
  const { stdout } = run(root);
  assert.match(stdout, /\| `web\/e2e\/a11y\.spec\.ts` \| ⏭️ 1 \|/);
});

test("spec rows link to the file with no line anchor", () => {
  const { stdout } = run(download({ Linux: report(PASSING, PASSING_STATS) }), {
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "o/r",
    HEAD_SHA: "abc123",
  });
  assert.match(stdout, /\[`web\/e2e\/a11y\.spec\.ts`\]\(https:\/\/github\.com\/o\/r\/blob\/abc123\/web\/e2e\/a11y\.spec\.ts\) \|/);
});

test("a leg whose report is unparseable warns and the other legs still render", () => {
  const root = download({ Linux: report(PASSING, PASSING_STATS), Windows: "{ broken" });
  const { status, stdout } = run(root);
  assert.equal(status, 0);
  assert.match(stdout, /⚠️ \*\*Windows\*\*: the report did not parse/);
  assert.match(stdout, /\| \*\*Total\*\* \| \*\*✅ 2\*\* \| ⚠️ \|/);
  assert.match(stdout, /across 1 runner\./);
});

test("a leg whose artifact has no results file warns", () => {
  const root = download({ Linux: report(PASSING, PASSING_STATS), macOS: null });
  const { stdout } = run(root);
  assert.match(stdout, /⚠️ \*\*macOS\*\*: no `playwright-results\.json` in the artifact/);
});

test("JSON of the wrong shape is treated as a bad artifact, not rendered as undefined", () => {
  const root = download({ Linux: { hello: "world" } });
  const { stdout } = run(root);
  assert.match(stdout, /is not a Playwright JSON report/);
  assert.doesNotMatch(stdout, /undefined/);
});

test("no artifacts at all says so instead of rendering an empty table", () => {
  const { status, stdout } = run(mkdtempSync(join(tmpdir(), "e2e-empty-")));
  assert.equal(status, 0);
  assert.match(stdout, /No Playwright result artifacts found/);
  assert.doesNotMatch(stdout, /\| Spec \|/);
});

test("a download directory that does not exist is handled like no artifacts", () => {
  const { status, stdout } = run("/nope/not-a-dir");
  assert.equal(status, 0);
  assert.match(stdout, /No Playwright result artifacts found/);
});

test("the spec root is derived from the leg's own rootDir, not assumed", () => {
  // Without GITHUB_REPOSITORY there is no marker to cut on, so the fallback
  // stands in - which is what every other test in this file exercises.
  const { stdout } = run(download({ Linux: report(PASSING, PASSING_STATS) }), {
    GITHUB_REPOSITORY: "DataCrusade1999/supreme-enigma",
  });
  assert.match(stdout, /\| `web\/e2e\/a11y\.spec\.ts` \|/);
  assert.doesNotMatch(stdout, /`web\/a11y\.spec\.ts`/);
  assert.doesNotMatch(stdout, /e2e\/e2e/);
});

test("a Windows leg's backslash rootDir resolves to the same repo-relative root", () => {
  const win = report(PASSING, PASSING_STATS);
  win.config.rootDir = "D:\\a\\supreme-enigma\\supreme-enigma\\web\\e2e";
  const { stdout } = run(download({ Windows: win }), {
    GITHUB_REPOSITORY: "DataCrusade1999/supreme-enigma",
  });
  assert.match(stdout, /\| `web\/e2e\/a11y\.spec\.ts` \|/);
  assert.ok(!stdout.includes("\\"), "backslashes must be normalised out of the rendered paths");
});

test("a testDir one level deeper is followed rather than hardcoded", () => {
  const deeper = report(PASSING, PASSING_STATS);
  deeper.config.rootDir = "/home/runner/work/supreme-enigma/supreme-enigma/web/tests/browser";
  const { stdout } = run(download({ Linux: deeper }), {
    GITHUB_REPOSITORY: "DataCrusade1999/supreme-enigma",
  });
  assert.match(stdout, /\| `web\/tests\/browser\/a11y\.spec\.ts` \|/);
});

test("usage error without a directory argument", () => {
  const r = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
  assert.equal(r.status, 1);
});
