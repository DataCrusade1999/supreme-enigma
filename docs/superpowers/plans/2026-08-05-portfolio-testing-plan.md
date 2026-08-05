# Portfolio Website Testing Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the two known unit-test gaps (`SiteFooter`, blog pages), codify
testing conventions in `app/TESTING.md`, add a Playwright e2e + accessibility
suite for the 7 public pages, and wire both test runners into CI with rich
`$GITHUB_STEP_SUMMARY` pass/fail reporting.

**Architecture:** Unit gaps use the existing Vitest + Testing Library
conventions, with one new pattern (`await Component()` before `render()`) for
async server-component pages — discovered during design work to have a real
limit: it works for `blog/page.tsx` (plain data + sync children) but not
`blog/[slug]/page.tsx`'s full output, since that page nests
`next-mdx-remote/rsc`'s `<MDXRemote>`, an async Server Component that plain
jsdom rendering can't resolve (confirmed empirically — produces an empty
`<div />`, not the post content). Real post-content verification for that
page moves to Playwright, which runs against a real Next.js server capable of
resolving RSC. CI gets a hand-rolled `.github/scripts/test-summary.mjs` that
parses both runners' JSON output into a markdown job summary.

**Tech Stack:** Vitest + `@testing-library/react` (existing), Playwright
(`@playwright/test`, new) + `@axe-core/playwright` (new) for e2e/a11y, plain
Node.js (`.mjs`, no new runtime deps) for the CI summary script.

## Global Constraints

- Unit tests stay in the existing Vitest + Testing Library toolchain — no new
  unit-test dependencies.
- `blog/[slug]/page.test.tsx` unit-tests only the `notFound()` path for an
  unknown slug — **not** full rendered post content (empirically confirmed
  infeasible with plain `render()`; see Task 2).
- Playwright suite lives at `app/e2e/`, config at `app/playwright.config.ts`,
  scoped to exactly 7 public pages: `/`, `/about`, `/projects`, `/resume`,
  `/contact`, `/blog`, `/blog/hello-world`. Chromium only.
- Playwright's dev server runs via `npm run build && npm run start -- -p 3100`
  on port 3100 (not 3000, to avoid colliding with a local dev server), with
  `APP_PASSWORD=test123 COOKIE_SECRET=devsecret` — the same convention as the
  documented local-dev command.
- `vitest.config.ts`'s `exclude` must explicitly list Vitest's defaults plus
  `e2e/**` (Vitest replaces its default exclude list entirely when `exclude`
  is set, rather than merging) — otherwise Vitest's default glob
  (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) also picks up Playwright spec files.
- Vitest JSON reporter output follows the Jest-compatible schema (verified
  empirically): top-level `numTotalTests`/`numPassedTests`/`numFailedTests`/
  `numPendingTests`, `testResults[]` with `name` + `assertionResults[]`
  (`title`, `fullName`, `status`, `failureMessages[]`).
- CI: both the Vitest and Playwright run steps capture their real exit code
  via the `cmd || EXIT_CODE=$?` pattern (the one construct `bash -e` doesn't
  treat as fatal) into a `$GITHUB_OUTPUT` value, so a summary step marked
  `if: always()` can run even after a failure, and a final step explicitly
  fails the job if either exit code was nonzero — keeping
  `needs.test.result` correct for the `deploy`/`deploy_demucs`/`release` jobs
  downstream.
- `.github/scripts/test-summary.mjs` takes `--kind vitest|playwright
  <results-file>`, appends markdown to `$GITHUB_STEP_SUMMARY` (falls back to
  stdout if that env var is unset, for local runs), and degrades gracefully
  (prints a warning instead of crashing) if the results file doesn't exist.

---

### Task 1: `SiteFooter` unit test

**Files:**
- Create: `app/components/site/SiteFooter.test.tsx`

**Interfaces:**
- Consumes: `SiteFooter` (existing, `app/components/site/SiteFooter.tsx`).
- Produces: nothing consumed by later tasks — closes the first of the two
  known coverage gaps.

- [ ] **Step 1: Write the failing test**

`app/components/site/SiteFooter.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteFooter } from "./SiteFooter";

describe("SiteFooter", () => {
  it("renders the copyright line and tech stack", () => {
    render(<SiteFooter />);
    expect(
      screen.getByText(`© ${new Date().getFullYear()} Ashutosh Pandey`),
    ).toBeInTheDocument();
    expect(
      screen.getByText("next · vercel · aws lambda · python dsp"),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd app && npx vitest run components/site/SiteFooter.test.tsx`
Expected: PASS (1 test) — this component already exists, so there's no
red step here, just confirmation the new test is correct.

- [ ] **Step 3: Commit**

```bash
git add app/components/site/SiteFooter.test.tsx
git commit -m "test(app): add SiteFooter coverage"
```

---

### Task 2: Blog page unit tests

**Files:**
- Create: `app/app/(site)/blog/page.test.tsx`
- Create: `app/app/(site)/blog/[slug]/page.test.tsx`

**Interfaces:**
- Consumes: `BlogPage` (existing, `app/app/(site)/blog/page.tsx`), `PostPage`
  (existing, `app/app/(site)/blog/[slug]/page.tsx`), the real
  `content/blog/hello-world.mdx` fixture via `getReader()`.
- Produces: nothing consumed by later tasks — closes the second known
  coverage gap.

- [ ] **Step 1: Write the blog list page test**

`app/app/(site)/blog/page.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import BlogPage from "./page";

describe("BlogPage", () => {
  it("renders the Blog heading and links to the seed post", async () => {
    const jsx = await BlogPage();
    render(jsx);
    expect(
      screen.getByRole("heading", { level: 1, name: "Blog" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hello, World" })).toHaveAttribute(
      "href",
      "/blog/hello-world",
    );
  });
});
```
This works because `BlogPage`'s tree is plain data plus the synchronous
`BlogList` component — nothing async nested inside, unlike the post-detail
page in Step 2.

- [ ] **Step 2: Write the post-detail page test**

`app/app/(site)/blog/[slug]/page.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import PostPage from "./page";

describe("PostPage", () => {
  it("calls notFound() for an unknown slug", async () => {
    await expect(
      PostPage({ params: Promise.resolve({ slug: "does-not-exist" }) }),
    ).rejects.toThrow();
  });
});
```
This is deliberately the only assertion here — `PostPage`'s successful path
renders `<MDXRemote>` (from `next-mdx-remote/rsc`), an async Server
Component that plain `@testing-library/react` `render()` cannot resolve in
jsdom (confirmed empirically while writing this plan: rendering an awaited
`PostPage(...)` tree produces an empty `<div />` and a console error, not
the post content — there's no RSC-capable renderer in a Vitest/jsdom
environment). Real post-content verification lives in the Playwright suite
instead (Task 4).

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd app && npx vitest run "app/(site)/blog"`
Expected: PASS (2 tests total across both files)

- [ ] **Step 4: Commit**

```bash
git add "app/app/(site)/blog/page.test.tsx" "app/app/(site)/blog/[slug]/page.test.tsx"
git commit -m "test(app): add blog page coverage (list + notFound path)"
```

---

### Task 3: Testing conventions doc

**Files:**
- Create: `app/TESTING.md`

**Interfaces:**
- Consumes: nothing — a reference doc, not code.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the doc**

`app/TESTING.md`:
```markdown
# Testing

Two test runners, two jobs: **Vitest** (`npm test`) for unit/component
tests, **Playwright** (`npx playwright test`) for end-to-end and
accessibility tests against a real running server. Neither runner picks up
the other's files — Vitest's `vitest.config.ts` explicitly excludes `e2e/**`.

## What to test, by file type

- **Plain (synchronous) pages** (`app/(site)/about/page.tsx`, etc.): render
  directly, assert on the heading/key content.
  `render(<AboutPage />)`.
- **Async server-component pages** (anything reading from Keystatic, e.g.
  `app/(site)/blog/page.tsx`): `await` the component function first to
  resolve its JSX, *then* render it — `const jsx = await BlogPage();
  render(jsx)`. This only works if nothing async is nested further down the
  tree. If a page nests another async Server Component (e.g. `blog/[slug]`
  nests `next-mdx-remote/rsc`'s `<MDXRemote>`), `render()` cannot resolve
  it — Vitest/jsdom has no RSC-capable renderer. Test whatever page-level
  logic doesn't require resolving that inner component (e.g. a `notFound()`
  path), and move full-content verification to the Playwright suite, which
  runs against a real Next.js server.
- **Client components** (`"use client"`, e.g. `ThemeToggle`): render, drive
  interaction with `fireEvent`, assert on the result.
- **`lib/` functions**: unit-test pure logic directly. Functions that call
  the AWS SDK (`presignUpload`, `presignDownload`, `objectExists`) are
  **not** unit-tested — matches `lib/aws.test.ts`'s existing scope, which
  only covers the pure-logic helpers (`keyForUpload`, `deriveOutputKey`,
  `deriveOutputPrefix`).
- **API routes** (`app/api/**/route.ts`): no isolated route-handler test
  convention exists in this repo. Covered indirectly through page-level
  `fetch` mocks instead (see below).

## Mocking `fetch`

Pages that call `fetch` (e.g. `tools/bgm-looper/page.tsx`,
`tools/bgm-extractor/page.tsx`) are tested by stubbing the global fetch with
a `mockResolvedValueOnce` chain matching the real call sequence:

```tsx
vi.stubGlobal(
  "fetch",
  vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ /* ... */ }) })
    // one entry per real fetch call, in order
);
```

## When to reach for e2e instead of a unit test

- Cross-page navigation.
- Anything depending on real browser behavior a jsdom unit test can't
  produce: `localStorage` persistence, the real pre-hydration `<html
  class="dark">` script actually running, a full-page accessibility scan.
- Full rendered output of a page that nests an async Server Component
  a jsdom render can't resolve (see above).

## Running everything

- `npm test` — unit/component tests (Vitest).
- `npx playwright test` — e2e + accessibility tests (Playwright). Builds and
  starts the app on port 3100 automatically (see `playwright.config.ts`);
  run `npm run build` once yourself first if you want faster repeat runs.
```

- [ ] **Step 2: Commit**

```bash
git add app/TESTING.md
git commit -m "docs(app): add testing conventions reference"
```

---

### Task 4: Playwright scaffold + page-load tests

**Files:**
- Create: `app/playwright.config.ts`
- Create: `app/e2e/pages.spec.ts`
- Modify: `app/vitest.config.ts`, `app/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the `app/e2e/` directory and Playwright config every later e2e
  task (5, 6) adds spec files into. `playwright-results.json` (git-ignored,
  generated at test-run time) — Task 7's summary script parses this file's
  real shape.

- [ ] **Step 1: Install Playwright**

Run: `cd app && npm install --save-dev @playwright/test`
Expected: `@playwright/test` added to `devDependencies` in `package.json`.

Run: `npx playwright install --with-deps chromium`
Expected: Chromium browser binary downloaded (this can take a few minutes
on first run).

- [ ] **Step 2: Write the Playwright config**

`app/playwright.config.ts`:
```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  reporter: [["list"], ["json", { outputFile: "playwright-results.json" }]],
  use: {
    baseURL: "http://localhost:3100",
  },
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      APP_PASSWORD: "test123",
      COOKIE_SECRET: "devsecret",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```
Port 3100 (not 3000) avoids colliding with a dev server someone might
already have running locally. `timeout: 180_000` (3 min) gives `next build`
enough room — it's slower than just starting an already-built server.

- [ ] **Step 3: Fix the Vitest/Playwright file-matching collision**

In `app/vitest.config.ts`, change:
```typescript
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
```
to:
```typescript
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
  },
});
```
Vitest replaces its default `exclude` list entirely when one is provided
(rather than merging), so the common defaults are spelled out explicitly
alongside the new `e2e/**` entry — omitting them would silently stop
excluding `node_modules` etc.

- [ ] **Step 4: Write the page-load tests**

`app/e2e/pages.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";

const PAGES = [
  { path: "/", heading: "Ashutosh Pandey" },
  { path: "/about", heading: "About" },
  { path: "/projects", heading: "Projects" },
  { path: "/resume", heading: "Resume" },
  { path: "/contact", heading: "Contact" },
  { path: "/blog", heading: "Blog" },
  { path: "/blog/hello-world", heading: "Hello, World" },
];

for (const { path, heading } of PAGES) {
  test(`${path} loads and shows its heading`, async ({ page }) => {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
  });
}
```

- [ ] **Step 5: Add a convenience npm script**

In `app/package.json`, change:
```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "lint": "eslint ."
  },
```
to:
```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "lint": "eslint ."
  },
```

- [ ] **Step 6: Add generated Playwright output to `.gitignore`**

Add to `app/.gitignore` (create the file with these lines if it doesn't
already have a Playwright section):
```gitignore
/test-results/
/playwright-report/
playwright-results.json
vitest-results.json
```

- [ ] **Step 7: Run the suite to verify it passes**

Run: `cd app && npx playwright test e2e/pages.spec.ts`
Expected: PASS (7 tests). First run builds the app, so this can take a
couple of minutes.

- [ ] **Step 8: Verify Vitest didn't pick up the new e2e file**

Run: `cd app && npx vitest run`
Expected: same test file count as before this task (no `e2e/pages.spec.ts`
listed among the run files) — confirms Step 3's `exclude` fix works.

- [ ] **Step 9: Commit**

```bash
git add app/playwright.config.ts app/e2e/pages.spec.ts app/vitest.config.ts app/package.json app/package-lock.json app/.gitignore
git commit -m "feat(app): add Playwright e2e scaffold with page-load tests"
```

---

### Task 5: Navigation + theme e2e tests

**Files:**
- Create: `app/e2e/navigation.spec.ts`
- Create: `app/e2e/theme.spec.ts`

**Interfaces:**
- Consumes: the Playwright config and running-server setup from Task 4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the navigation test**

`app/e2e/navigation.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";

test("header nav links navigate between pages", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL("/about");
  await expect(
    page.getByRole("heading", { level: 1, name: "About" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL("/projects");
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Blog" }).click();
  await expect(page).toHaveURL("/blog");
  await expect(
    page.getByRole("heading", { level: 1, name: "Blog" }),
  ).toBeVisible();
});
```

- [ ] **Step 2: Write the theme toggle test**

`app/e2e/theme.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";

test("theme toggle flips the dark class and persists across navigation", async ({
  page,
}) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/);

  await page.getByRole("button", { name: "Light mode" }).click();
  await expect(html).not.toHaveClass(/dark/);
  const stored = await page.evaluate(() => localStorage.getItem("theme"));
  expect(stored).toBe("light");

  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL("/about");
  await expect(html).not.toHaveClass(/dark/);
});
```
The toggle button's accessible name is "Light mode" while the site is in
dark mode (its default) — it names the mode clicking it switches *to*, per
`ThemeToggle.tsx`'s `{isDark ? "Light mode" : "Dark mode"}`.

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd app && npx playwright test e2e/navigation.spec.ts e2e/theme.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 4: Commit**

```bash
git add app/e2e/navigation.spec.ts app/e2e/theme.spec.ts
git commit -m "test(app): add e2e navigation and theme-persistence tests"
```

---

### Task 6: Accessibility e2e tests

**Files:**
- Create: `app/e2e/a11y.spec.ts`
- Modify: `app/package.json`

**Interfaces:**
- Consumes: the Playwright config from Task 4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Install `@axe-core/playwright`**

Run: `cd app && npm install --save-dev @axe-core/playwright`

- [ ] **Step 2: Write the accessibility tests**

`app/e2e/a11y.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PATHS = [
  "/",
  "/about",
  "/projects",
  "/resume",
  "/contact",
  "/blog",
  "/blog/hello-world",
];

for (const path of PATHS) {
  test(`${path} has no automatically detectable accessibility violations`, async ({
    page,
  }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd app && npx playwright test e2e/a11y.spec.ts`
Expected: PASS (7 tests). If a real violation surfaces, fix the underlying
markup/contrast issue rather than loosening the assertion — this is a
public-facing site.

- [ ] **Step 4: Commit**

```bash
git add app/e2e/a11y.spec.ts app/package.json app/package-lock.json
git commit -m "test(app): add e2e accessibility scans for all public pages"
```

---

### Task 7: CI job-summary script

**Files:**
- Create: `.github/scripts/test-summary.mjs`

**Interfaces:**
- Consumes: a Vitest JSON report (schema confirmed empirically in this
  plan's design phase — see Global Constraints) or a Playwright JSON report
  (`app/playwright-results.json`, generated by Task 4's config; exact schema
  verified in Step 3 below, since Playwright wasn't installed yet when this
  plan was written).
- Produces: `node .github/scripts/test-summary.mjs --kind <vitest|playwright>
  <path>` — appends a markdown section to `$GITHUB_STEP_SUMMARY`, or prints
  to stdout if that env var is unset. Task 8's CI workflow calls this
  exactly.

- [ ] **Step 1: Write the script**

`.github/scripts/test-summary.mjs`:
```javascript
import { readFileSync, appendFileSync, existsSync } from "node:fs";

const [, , flag, kind, filePath] = process.argv;
if (flag !== "--kind" || (kind !== "vitest" && kind !== "playwright") || !filePath) {
  console.error("Usage: node test-summary.mjs --kind <vitest|playwright> <results-file>");
  process.exit(1);
}

function summarizeVitest(data) {
  const lines = ["## Unit tests (Vitest)", ""];
  lines.push(
    `**${data.numPassedTests} passed**, **${data.numFailedTests} failed**, ${data.numPendingTests} skipped, ${data.numTotalTests} total`,
  );
  lines.push("");
  if (data.numFailedTests > 0) {
    lines.push("### Failures", "");
    for (const file of data.testResults) {
      for (const assertion of file.assertionResults) {
        if (assertion.status !== "failed") continue;
        lines.push(`<details><summary>❌ ${assertion.fullName} (${file.name})</summary>`, "");
        lines.push("```", (assertion.failureMessages || []).join("\n\n"), "```", "</details>", "");
      }
    }
  }
  return lines;
}

function walkPlaywrightSuite(suite, failureLines, counts) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      for (const result of t.results) {
        counts.total += 1;
        if (result.status === "passed") counts.passed += 1;
        else if (result.status === "skipped") counts.skipped += 1;
        else {
          counts.failed += 1;
          failureLines.push(
            `<details><summary>❌ ${spec.title} (${spec.file})</summary>`,
            "",
            "```",
            result.error?.message ?? "no error message captured",
            "```",
            "</details>",
            "",
          );
        }
      }
    }
  }
  for (const child of suite.suites ?? []) {
    walkPlaywrightSuite(child, failureLines, counts);
  }
}

function summarizePlaywright(data) {
  const failureLines = [];
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  for (const suite of data.suites ?? []) {
    walkPlaywrightSuite(suite, failureLines, counts);
  }
  const lines = ["## E2E + accessibility tests (Playwright)", ""];
  lines.push(
    `**${counts.passed} passed**, **${counts.failed} failed**, ${counts.skipped} skipped, ${counts.total} total`,
  );
  lines.push("");
  if (counts.failed > 0) {
    lines.push("### Failures", "", ...failureLines);
  }
  return lines;
}

let summaryLines;
if (!existsSync(filePath)) {
  summaryLines = [
    kind === "vitest" ? "## Unit tests (Vitest)" : "## E2E + accessibility tests (Playwright)",
    "",
    `⚠️ No results file found at \`${filePath}\` — the test run likely crashed before producing output.`,
  ];
} else {
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  summaryLines = kind === "vitest" ? summarizeVitest(data) : summarizePlaywright(data);
}

const output = summaryLines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
} else {
  console.log(output);
}
```

- [ ] **Step 2: Verify against a real Vitest report (pass and fail paths)**

Run: `cd app && npx vitest run --reporter=default --reporter=json --outputFile.json=vitest-results.json && cd .. && node .github/scripts/test-summary.mjs --kind vitest app/vitest-results.json`
Expected: prints a `## Unit tests (Vitest)` section with a pass count
matching the real suite (no `### Failures` section).

Now temporarily break a test to check the failure path — edit
`app/components/site/SiteFooter.test.tsx`'s expected text to something wrong
(e.g. `"nope"` instead of the real copyright string), then:

Run: `cd app && npx vitest run --reporter=default --reporter=json --outputFile.json=vitest-results.json ; cd .. && node .github/scripts/test-summary.mjs --kind vitest app/vitest-results.json`
Expected: prints a `### Failures` section with a `<details>` block naming
the broken test and showing its real assertion error.

Revert the temporary breakage in `SiteFooter.test.tsx` back to the real
assertion before continuing.

- [ ] **Step 3: Verify against a real Playwright report, and correct the parser if the real schema differs**

Run: `cd app && npx playwright test && cd .. && node .github/scripts/test-summary.mjs --kind playwright app/playwright-results.json`
Expected: prints an `## E2E + accessibility tests (Playwright)` section
with a pass count matching the real suite.

If the printed counts are `0 passed, 0 failed, 0 skipped, 0 total` despite
the real run showing tests passed, inspect the actual file
(`cat app/playwright-results.json` or open it) and compare its real
top-level shape (`suites`/`stats`) against what `walkPlaywrightSuite`
expects — adjust the field names in Step 1's script to match, then re-run
this verification until the counts agree with the real Playwright console
output.

Now check the failure path: temporarily break `app/e2e/pages.spec.ts` (e.g.
change one page's expected heading text to something wrong), then:

Run: `cd app && npx playwright test ; cd .. && node .github/scripts/test-summary.mjs --kind playwright app/playwright-results.json`
Expected: prints a `### Failures` section with a `<details>` block naming
the broken test and showing Playwright's real assertion error.

Revert the temporary breakage in `pages.spec.ts` before continuing.

- [ ] **Step 4: Clean up generated files and commit**

```bash
rm -f app/vitest-results.json app/playwright-results.json
git add .github/scripts/test-summary.mjs
git commit -m "feat(ci): add hand-rolled test-summary script for job summaries"
```

---

### Task 8: Wire both test runners into CI with rich job summaries

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `.github/scripts/test-summary.mjs` (Task 7), the Playwright
  suite (Tasks 4–6).
- Produces: on every push/PR, the `test` job now runs both Vitest and
  Playwright, and the workflow run page's Summary section shows pass/fail
  counts and failure details for both.

- [ ] **Step 1: Replace the "Run app tests" step and add the new steps**

In `.github/workflows/deploy.yml`'s `test` job, change:
```yaml
      - name: Run app tests
        working-directory: app
        run: npm test
```
to:
```yaml
      - name: Run app tests
        id: vitest
        working-directory: app
        run: |
          set -o pipefail
          EXIT_CODE=0
          npx vitest run --reporter=default --reporter=json --outputFile.json=vitest-results.json || EXIT_CODE=$?
          echo "exit_code=$EXIT_CODE" >> "$GITHUB_OUTPUT"

      - name: Vitest job summary
        if: always()
        run: node .github/scripts/test-summary.mjs --kind vitest app/vitest-results.json

      - name: Install Playwright browsers
        working-directory: app
        run: npx playwright install --with-deps chromium

      - name: Run e2e + a11y tests
        id: playwright
        working-directory: app
        env:
          APP_PASSWORD: test123
          COOKIE_SECRET: devsecret
        run: |
          set -o pipefail
          EXIT_CODE=0
          npx playwright test || EXIT_CODE=$?
          echo "exit_code=$EXIT_CODE" >> "$GITHUB_OUTPUT"

      - name: Playwright job summary
        if: always()
        run: node .github/scripts/test-summary.mjs --kind playwright app/playwright-results.json

      - name: Fail the job if any test suite failed
        if: steps.vitest.outputs.exit_code != '0' || steps.playwright.outputs.exit_code != '0'
        run: exit 1
```
The `cmd || EXIT_CODE=$?` construct is the one thing `bash -eo pipefail`
(GitHub Actions' default step shell) doesn't treat as fatal — being part of
an `||` list is one of `set -e`'s documented exceptions — so this reliably
captures the real exit code without needing `continue-on-error` on the
step, and without the script aborting before it can write `$GITHUB_OUTPUT`.

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat(ci): run Playwright e2e/a11y tests with rich job summaries"
git push origin HEAD
```

- [ ] **Step 3: Watch the real CI run and confirm the summary renders correctly**

Run: `gh run list --workflow=deploy.yml --limit 1` then `gh run watch <run-id>`
Expected: `test` job passes, including the new Playwright steps.

Open the run in a browser (`gh run view <run-id> --web`) and check the
Summary section at the top of the run page: it should show both
`## Unit tests (Vitest)` and `## E2E + accessibility tests (Playwright)`
sections with real pass counts (43+ Vitest tests, 16 Playwright tests: 7
page-load + 2 navigation/theme + 7 a11y), no `### Failures` sections.

- [ ] **Step 4: Verify the failure-reporting path on a real CI run**

Temporarily break something trivial (e.g. change one heading assertion in
`app/e2e/pages.spec.ts` to the wrong text), commit as a throwaway commit,
and push:
```bash
git add app/e2e/pages.spec.ts
git commit -m "chore: temporarily break a test to verify CI failure reporting"
git push origin HEAD
```
Watch the run the same way as Step 3. Expected: the job fails, and the
Summary page's Playwright section shows a `### Failures` block naming the
broken test with a real Playwright error message inside a collapsed
`<details>`.

Revert the throwaway breakage:
```bash
git revert HEAD --no-edit
git push origin HEAD
```
Watch one more run to confirm it's green again with clean summaries.
