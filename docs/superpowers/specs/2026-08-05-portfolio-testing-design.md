# Portfolio Website Testing Plan — Design Spec

Date: 2026-08-05

## 1. Purpose

Strengthen test coverage for the public portfolio site (`app/app/(site)/` —
home, about, projects, resume, contact, blog) and codify the testing
conventions this codebase already implicitly follows, so future page/component
work has a clear bar to hit. Scoped to what's live today; the several
planned-but-unbuilt portfolio features (3D hero, motion/GIFs, newsletter,
terminal layer — see `docs/superpowers/specs/2026-08-04-portfolio-*-design.md`)
get their own testing conventions folded into their own implementation plans
when they're actually built, same as everything else in this repo. The
password-gated BGM Looper tool is out of scope — it already has its own unit
test coverage and CLAUDE.md itself treats it as a separate concern from "the
portfolio pages."

## 2. Current state

- 16 Vitest + Testing Library test files, 43 tests, all passing. Nearly every
  page/component already has at least one test.
- Two gaps: `components/site/SiteFooter.tsx` and the two blog pages
  (`app/(site)/blog/page.tsx`, `app/(site)/blog/[slug]/page.tsx`) have no
  tests.
- No end-to-end, visual-regression, or accessibility testing exists anywhere
  in the repo — coverage today is unit/component-level only.

## 3. Scope

1. Fill the two unit-test gaps.
2. Write down testing conventions in a new `app/TESTING.md`.
3. Add Playwright for end-to-end + accessibility testing of the 7 public
   pages (home, about, projects, resume, contact, blog list, blog post).
4. Wire the new e2e/a11y suite into CI.

Explicitly not in this pass: visual regression (screenshot diffing),
performance/Lighthouse budgets, testing conventions for unbuilt features,
and any coverage of `/tools/bgm-looper`.

## 4. Unit-test gaps

**`SiteFooter.test.tsx`** — renders `<SiteFooter />`, asserts the copyright
text and the `next · vercel · aws lambda · python dsp` tech-stack line are
present. Straightforward; matches the existing render-and-assert pattern used
by every other component test in this repo.

**`blog/page.test.tsx` and `blog/[slug]/page.test.tsx`** — both source files
are `async function` server components (`BlogPage()`, `PostPage({ params })`),
which is new: every currently-tested page (`about/page.tsx`, etc.) is a plain
synchronous function, and the existing `render(<AboutPage />)` pattern can't
resolve a Promise-returning component directly. These two tests instead
`await` the component function to resolve its JSX first, then `render()` the
result:

```tsx
const jsx = await BlogPage();
render(jsx);
```
```tsx
const jsx = await PostPage({ params: Promise.resolve({ slug: "hello-world" }) });
render(jsx);
```

Both exercise the real `getReader()` against the real
`content/blog/hello-world.mdx` fixture — no mocking of Keystatic or the
filesystem, matching the no-mocking approach `lib/keystatic-reader.test.ts`
already established for this same reader.

## 5. `app/TESTING.md`

A new reference doc, not a spec — written once, kept up to date as
conventions evolve. Contents:

- **What to test per file type**: pages (renders expected heading/content;
  server-component pages use the `await Component()` pattern from §4), client
  components (`"use client"` — render + interaction via `fireEvent`), `lib/`
  functions (pure logic unit-tested directly; AWS-SDK-calling functions are
  *not* unit-tested, matching the existing `aws.test.ts` convention of only
  testing `keyForUpload`/`deriveOutputKey`/`deriveOutputPrefix`, not
  `presignUpload`/`presignDownload`/`objectExists`), API routes (no existing
  convention for isolated route-handler tests in this repo — covered
  indirectly via page-level `fetch` mocks instead, as `bgm-extractor`'s routes
  already are).
- **Mocking conventions**: the `vi.stubGlobal("fetch", ...)` +
  `mockResolvedValueOnce` chain pattern used by every page that calls
  `fetch` (`bgm-looper/page.test.tsx`, `bgm-extractor/page.test.tsx`).
- **When to reach for e2e instead of a unit test**: cross-page navigation,
  anything depending on real browser behavior (localStorage persistence,
  actual `<html class="dark">` application), or a full-page accessibility
  scan — the 3 things a jsdom unit test can't meaningfully exercise.
- **How to run everything**: `npm test` (unit), `npx playwright test` (e2e,
  requires `npm run build` first or lets Playwright's `webServer` handle it).

## 6. Playwright e2e + accessibility suite

**New directory**: `app/e2e/` — kept separate from `app/app/` and
`app/components/` so it's obviously a different test runner's territory at a
glance.

**`app/playwright.config.ts`**:
- `testDir: "./e2e"`
- `webServer`: `command: "npm run build && npm run start -- -p 3100"`,
  `url: "http://localhost:3100"`, `reuseExistingServer: !process.env.CI`,
  `env: { APP_PASSWORD: "test123", COOKIE_SECRET: "devsecret" }` — same
  convention as the documented local-dev command, and port 3100 (not 3000)
  so this doesn't collide with a dev server someone might already have
  running locally.
- `use: { baseURL: "http://localhost:3100" }`
- `reporter: [["list"], ["json", { outputFile: "playwright-results.json" }]]`
  — `list` for readable console output during the run, `json` for the
  machine-readable file the CI job-summary step (§8) parses. Configured here
  rather than via CLI flags so both local and CI runs produce the same
  artifact without remembering extra flags.

**Functional tests** (`app/e2e/pages.spec.ts`, `app/e2e/navigation.spec.ts`,
`app/e2e/theme.spec.ts`):
- Each of the 7 pages loads and shows its expected heading/key content.
- Header nav links navigate to the correct page from each other page.
- Theme toggle flips `<html>`'s `dark` class and writes to `localStorage`;
  reloading/navigating preserves the chosen theme (exercises the
  pre-hydration inline script CLAUDE.md documents, which a jsdom unit test
  can't — there's no real `<html>` pre-hydration step in jsdom).

**Accessibility tests** (`app/e2e/a11y.spec.ts`): `@axe-core/playwright`'s
`AxeBuilder` run against each of the 7 pages, asserting zero violations. One
parametrized test looping the 7 routes, not 7 separate files.

**New devDependencies**: `@playwright/test`, `@axe-core/playwright`.

## 7. Tooling collision guard

Vitest's default file-matching (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) would
also pick up files under `app/e2e/` if not explicitly excluded, since
Playwright spec files match the same default glob. `vitest.config.ts` needs
an explicit `exclude` list (Vitest replaces its defaults entirely when
`exclude` is provided, rather than merging — so the full default list must be
spelled out alongside the new entry, not just `["e2e/**"]` on its own):

```ts
exclude: [
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "e2e/**",
],
```

## 8. CI

### 8.1 Rich job summaries (pass/fail counts + why failures failed)

GitHub Actions renders whatever markdown a step appends to the
`$GITHUB_STEP_SUMMARY` file as a "Summary" section on the workflow run page —
this is the native mechanism to use, no marketplace action needed. Both test
runners can emit machine-readable JSON (Vitest's `json` reporter follows
Jest's schema: `numTotalTests`/`numPassedTests`/`numFailedTests` at the top
level, `testResults[].assertionResults[]` with `status`/`failureMessages` per
test; Playwright's `json` reporter reports `stats.expected`/`unexpected`/
`flaky`/`skipped`, with per-test detail nested under `suites[]` — recursively,
since suites can contain suites — down to `specs[].tests[].results[].error`).

One hand-rolled script, `.github/scripts/test-summary.mjs`, parses either
shape (`node .github/scripts/test-summary.mjs --kind vitest <path>` or
`--kind playwright <path>`) and appends a markdown section to
`$GITHUB_STEP_SUMMARY`: a one-line pass/fail/total count, and for each
failure, a `<details>` block (collapsed by default, so a summary with many
failures stays scannable) named after the failing test, containing its error
message/stack. Matches this repo's established preference for hand-rolled
CI scripting over marketplace actions (see the `changes` job's plain
`git diff --quiet` check, or the release job's inline Python for the
`CHANGELOG.md` rewrite).

Both the Vitest and Playwright run steps need the same shape of fix so a
test failure doesn't short-circuit past the summary step: GitHub Actions'
default shell runs with `bash -eo pipefail`, so a failing `npx vitest run`
would normally abort the step's script immediately, before a `$?`-capturing
line ever runs. Each run step instead does:

```bash
set -o pipefail
EXIT_CODE=0
npx vitest run --reporter=default --reporter=json --outputFile.json=vitest-results.json || EXIT_CODE=$?
echo "exit_code=$EXIT_CODE" >> "$GITHUB_OUTPUT"
```

(`cmd || EXIT_CODE=$?` is the one construct `set -e` doesn't treat as fatal —
being part of an `||` list is one of its documented exceptions — so this
reliably captures the real exit code without needing `continue-on-error` on
the step.) A summary step, marked `if: always()` so it still runs after a
test failure, then parses the JSON and appends the markdown. A final step
checks the captured `exit_code` output and does `exit 1` if nonzero, so the
job's overall pass/fail status — and everything downstream that depends on
it (`needs.test.result` in the `deploy`/`deploy_demucs`/`release` jobs) —
stays correct.

### 8.2 Workflow changes

Change the existing `test` job's `npm test` step and add the new Playwright
steps, all in `.github/workflows/deploy.yml`:

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

Chromium-only (not the full browser matrix) — this is a personal portfolio
site, not a cross-browser-compatibility-critical product; Chromium coverage
catches the overwhelming majority of real regressions at a fraction of the
CI time and flakiness risk of running WebKit/Firefox too. `next build` runs
as part of Playwright's own `webServer` startup, so no separate build step is
needed.

## 9. Explicitly out of scope (YAGNI)

- Visual regression / screenshot diffing.
- Performance or Lighthouse budgets.
- Testing conventions for the unbuilt portfolio features (3D hero,
  motion/GIFs, newsletter, terminal layer) — each gets its own testing
  approach in its own implementation plan when actually built.
- Any coverage of `/tools/bgm-looper` or `/tools/bgm-extractor` — both are
  a separate concern from "the portfolio," and BGM Looper already has its
  own unit coverage.
- Cross-browser (WebKit/Firefox) or mobile-viewport e2e coverage.
- API route handler unit tests — no existing convention for this in the
  repo; not introduced here either.
