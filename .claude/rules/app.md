---
paths:
  - app/**
---

# `app/` — Next.js frontend

Commands live in the root `CLAUDE.md`. This file is the per-file detail.

- `app/CLAUDE.md` is a one-line `@AGENTS.md` import and `app/AGENTS.md` is auto-generated — `next dev` re-creates both (they're committed deliberately, see 8e0efe0). Don't delete either; deleting just recreates an uncommitted diff. Don't hand-edit them either — put app guidance in this rules file instead.
- `app/TESTING.md` — unit-test conventions for async server components, and when to reach for e2e instead.
- The auth gate is `app/proxy.ts` (Next 16's rename of `middleware.ts` — there is no `middleware.ts`), tested by `app/proxy.test.ts`.
- Auth is a single shared password, not per-user: the session cookie payload is the literal string `"authenticated"` HMAC-signed with `COOKIE_SECRET`. There's no username or session ID.
- Only `/tools/bgm-looper`, `/api/looper/*`, `/keystatic`, and `/api/keystatic/*` require the shared password — `app/lib/route-gate.ts`'s `isGatedPath()` is the single source of truth for what's gated; the public portfolio pages have no auth check at all. `ALWAYS_ALLOWED_PATHS` (`/tools/bgm-looper/login`, `/api/login`) is carved back out of those gated prefixes, otherwise logging in would require being logged in. The tool's API routes were renamed from `/api/upload-url`/`/api/process` to `/api/looper/upload-url`/`/api/looper/process` to share one gated prefix with the page.
- **Styling is Tailwind CSS v4**, configured CSS-first in `app/app/globals.css` (no `tailwind.config.js`) — theme tokens (`--color-bg`, `--color-fg`, `--color-accent`, etc.) are declared once in a light `@theme` block and overridden in `:root.dark`, deliberately in both places so neither mode silently falls back to the other's value. Dark is the default; the toggle persists to `localStorage` and is applied pre-hydration by an inline script to avoid a flash.
- **`vitest.config.ts` sets `passWithNoTests: true`** deliberately, and setup imports `@testing-library/jest-dom/vitest` (not the plain `jest-dom` entrypoint) — both are load-bearing, don't "clean up". Its `exclude` spreads `configDefaults.exclude` before adding `**/.next/**` and `e2e/**` — Vitest replaces the default list entirely when one is given, so a hand-written list silently drops whichever defaults it forgets, and dropping `e2e/**` makes Vitest try to run the Playwright specs.
- `playwright.config.ts` builds and serves the app itself on port 3100 (180s timeout) and injects `APP_PASSWORD`/`COOKIE_SECRET`/all three `KEYSTATIC_*` — don't set them by hand, and don't point it at a dev server you started separately.
