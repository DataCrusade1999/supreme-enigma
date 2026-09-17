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

Pages that call `fetch` (e.g. `tools/bgm-looper/page.tsx`) are tested by
stubbing the global fetch with a `mockResolvedValueOnce` chain matching the
real call sequence:

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
- `npm run test:e2e` — e2e + accessibility tests (Playwright). Builds and
  starts the app on port 3100 automatically (see `playwright.config.ts`);
  run `npm run build` once yourself first if you want faster repeat runs.
  On a first checkout, install the browser binary once with
  `npx playwright install chromium` (add `--with-deps` on Linux/CI).
