# Portfolio Editorial Redesign (UI Overhaul Phase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public portfolio's visual design with the locked editorial system — paper ground, Instrument Serif + IBM Plex Sans, a visible 12-column grid, ruled rows, a designed dark counterpart — and add the `/projects/[slug]` detail page with its demo-GIF slot.

**Architecture:** New token values in `globals.css` keeping phase 1's two-block structure; `next/font/google` faces on `<html>`; three new presentational components (`PageMasthead`, `GridBackdrop`, `LoopRing`) plus phase 4's `ProjectDemoGif`; every `(site)` page rewritten against the grid; one new route.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS v4 (CSS-first tokens, `motion-reduce:` variant), `next/font/google`. **No new package dependencies.**

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-09-04-portfolio-editorial-redesign-design.md`.
- Visual source of truth: the design canvas — https://claude.ai/code/artifact/7908c3d9-eae6-47bd-9608-2d48613509d8 (pages: Light / Dark / Motion / Explorations). When this plan and the canvas disagree, the canvas is right about *appearance*, this plan is right about *structure*.
- `cd app && npm test` must pass after every task. `npm run lint` must pass before the branch is opened for review.
- `TerminalWindow.tsx` and its test are **not** deleted — `CommandBar` renders it. Only `/projects` stops importing it.
- The bar envelope array is defined **once** and imported by both the home page and `LoopRing`. Do not duplicate it.
- Every new hover/transition is gated with `motion-reduce:`; every looping animation gets a `prefers-reduced-motion` rule in `globals.css`, matching the existing `.playhead` pattern.
- Token values are asserted in `lib/portfolio-tokens.test.ts` and mirrored in `globals.css`. Both change together, in the same commit, or the test lies.
- Placeholder content (`content/resume.ts`, About copy, `your-username` contact links, unset `demoGif`) stays as-is. Pages must render correctly with it. Writing real content is not part of this plan.
- Nothing under `app/tools/bgm-looper/` changes — the gated tool keeps its own look.

---

### Task 1: Tokens and type

**Files:**
- Modify: `app/lib/portfolio-tokens.test.ts`
- Modify: `app/app/globals.css`
- Modify: `app/app/layout.tsx`

**Interfaces:**
- Produces: `--color-bg/-fg/-muted/-line/-rule-heavy/-accent/-peak`, `--font-display`, `--font-ui` — consumed by every later task.

- [ ] **Step 1: Rewrite the token test first**

  Replace the `LIGHT`/`DARK` constants with the spec §9 values and assert the full table, both modes, at the 4.5 threshold. Keep the `TERMINAL` block untouched — the terminal chrome is unchanged. Add one assertion that dark's 72% heavy-rule colour still clears 3:1 against the dark ground (it is a graphic, not text). Run `npm test` and watch it fail.

- [ ] **Step 2: Move the values into `globals.css`**

  New values in the `@theme` block (light) and `:root.dark` (dark), both declared in full — phase 1's rule, unchanged. Add `--color-rule-heavy`: full ink in light, `rgba(236, 234, 229, 0.72)` in dark. Delete `--font-mono`/`--font-sans`, add `--font-display`/`--font-ui`. Test goes green.

- [ ] **Step 3: Load the faces**

  `next/font/google` in `app/app/layout.tsx`: `Instrument_Serif` (400 + italic) and `IBM_Plex_Sans` (400/500/600), each with `variable:` and the spec §7 fallbacks, applied to `<html>`. No `<link>` to `fonts.googleapis.com` anywhere.

- [ ] **Step 4: Verify**

  `npm test` green. `npm run build` succeeds (remember the Keystatic env vars — see CLAUDE.md). Load `/` and confirm both faces are self-hosted (no `fonts.gstatic.com` request in the network panel).

---

### Task 2: The shell — layout, header, footer

**Files:**
- Create: `app/components/site/GridBackdrop.tsx`, `GridBackdrop.test.tsx`
- Create: `app/components/site/PageMasthead.tsx`, `PageMasthead.test.tsx`
- Modify: `app/app/(site)/layout.tsx`
- Modify: `app/components/site/SiteHeader.tsx` + test
- Modify: `app/components/site/SiteFooter.tsx` + test
- Modify: `app/components/site/ThemeToggle.tsx` + test

**Interfaces:**
- Produces: `<GridBackdrop />`, `<PageMasthead eyebrow title right? />` — consumed by Tasks 3–7.

- [ ] **Step 1: Tests for the two new components**

  `GridBackdrop`: renders 12 rule elements, `aria-hidden`, does not trap pointer events. `PageMasthead`: renders eyebrow text, the title as the page's `h1`, and the optional right slot only when passed.

- [ ] **Step 2: Build them, then widen the shell**

  `(site)/layout.tsx`: the 768px column becomes the full-width 12-column container at 40px margins (20px under `sm`). `<main>` renders `GridBackdrop` behind its children.

- [ ] **Step 3: Header**

  Keep every existing link and `href` — the existing assertions must still pass. Restyle to the grid; add the divider, the `⌘K` trigger and the icon toggle in the order the canvas shows; the "BGM Looper" bar stays last.

- [ ] **Step 4: ThemeToggle becomes an icon**

  Sun/moon inline SVG, crossfade + rotate on the 160ms interaction curve, gated with `motion-reduce:`. **Test first:** `aria-label` reflects the *next* state ("Switch to light mode" while dark). Existing dark-class and `localStorage` assertions must keep passing untouched.

- [ ] **Step 5: Footer**

  Ruled top, stack items as a wrapping list, copyright centred beneath a hairline under `sm`. Keep the existing text content assertions.

- [ ] **Step 6: Verify**

  `npm test`. Browser: header and footer align to the column rules at desktop, wrap correctly at 390px, in both modes.

---

### Task 3: Home

**Files:**
- Create: `app/content/wave-envelope.ts`
- Modify: `app/app/(site)/page.tsx` + test
- Modify: `app/app/globals.css` (bar-rise + played-tint keyframes)

- [ ] **Step 1: Extract the envelope**

  Move `HEAD`, `BODY`, `WAVE`, `PEAK` out of `page.tsx` into `content/wave-envelope.ts` and import them back. Pure move — the existing home page test must pass unchanged before anything else is touched.

- [ ] **Step 2: Rebuild the page against the grid**

  Name at 148px over two lines, lede in 1–5, the three pipeline settings as a ruled table in 8–12 (values from `lambda/src/looper/` — −14.0 LUFS, 50ms, `top_db` 40), waveform full width over a 2px baseline with head/tail labels, action bar last. Update the page test for the new structure; keep its existing link assertions.

- [ ] **Step 3: Motion**

  Bar rise on load (560ms, 8ms stagger) and the played-region tint on the 9s loop clock, both in `globals.css` with a `prefers-reduced-motion` off-switch beside the existing `.playhead` rule.

- [ ] **Step 4: Verify**

  `npm test`. Browser, both modes, desktop + 390px + reduced motion: bars build once and only once, the tint resets at the wrap without a visible seam.

---

### Task 4: LoopRing and About

**Files:**
- Create: `app/components/site/LoopRing.tsx`, `LoopRing.test.tsx`
- Modify: `app/app/(site)/about/page.tsx` + test

- [ ] **Step 1: Test the ring's geometry**

  Imports the shared envelope; renders one bar per entry; the first and last `HEAD.length` bars carry the accent; bars over `PEAK` carry the peak colour; the seam mark and hand render. Assert it reads the array rather than hard-coding a count.

- [ ] **Step 2: Build it**

  Bar *i* at `-90° + i × (360/n)`, placement transform on a wrapper so the inner span is free for its own animation. Hairline hand on the 9s sweep; "Tail → head" mark on the ~3% seam flash. Props: `radius`, `scale`.

- [ ] **Step 3: About**

  Display-face opening sentence, two body paragraphs in 1–6, `LoopRing` in 8–12 above the metadata list. The placeholder copy stays bracketed and visible.

- [ ] **Step 4: Verify**

  Browser: ring closes cleanly at twelve o'clock, the mark fires once per revolution, reduced motion parks the hand with the mark still visible.

---

### Task 5: Projects list and the detail page

**Files:**
- Modify: `app/content/projects.ts`
- Create: `app/components/site/ProjectDemoGif.tsx`, `ProjectDemoGif.test.tsx`
- Create: `app/app/(site)/projects/[slug]/page.tsx`, `page.test.tsx`
- Modify: `app/app/(site)/projects/page.tsx` + test

**Interfaces:**
- Produces: `Project.demoGif?: string`; `/projects/[slug]`.

- [ ] **Step 1: `demoGif` on the type**

  Optional `demoGif?: string` (path under `/public`). Left unset on `bgm-looper`.

- [ ] **Step 2: `ProjectDemoGif`, test first**

  Phase 4 spec §4 verbatim: plain `<img>` (not `next/image` — it re-encodes and breaks GIF animation; the `@next/next/no-img-element` disable must carry that reason inline), required `alt`/`width`/`height`, `priority` controlling `loading`.

- [ ] **Step 3: The detail page, test first**

  `generateStaticParams()` over `content/projects.ts`; `notFound()` on an unknown slug; GIF section rendered when `demoGif` is set and cleanly absent when not — test both with a fixture that has it and one that does not.

  Layout per spec §4: back link, masthead with the "Open the tool" bar in the right slot, GIF at 16:9 across 1–8 with `priority`, "built with" / "settings" in 10–12, description in 1–5 beside the four pipeline steps in 7–12.

- [ ] **Step 4: The list points inward**

  Rows link to `/projects/[slug]`, not `project.href`; update the existing assertion to match. Ruled rows with the chevron in column 12; indent + wash + chevron slide on one 200ms curve, `motion-reduce:` gated.

- [ ] **Step 5: Verify**

  `npm test`. Browser: hover a row, follow it through to the detail page, both modes.

---

### Task 6: Resume, Blog, Contact

**Files:**
- Modify: `app/app/(site)/resume/page.tsx` + test
- Modify: `app/app/(site)/blog/page.tsx`, `app/components/blog/BlogList.tsx` + tests
- Modify: `app/app/(site)/contact/page.tsx` + test

- [ ] **Step 1: Resume** — dates in 1–2 (accent, tabular-nums), role/org in 3–8, bullets in 9–12, `PageMasthead` with the Download PDF bar in the right slot. Renders correctly against the placeholder entry.
- [ ] **Step 2: Blog** — `BlogList` rows share the projects rhythm: date in 1–2, serif title + summary in 3–9, tags right in 10–12. Keep the existing slug/href assertions.
- [ ] **Step 3: Contact** — ruled rows, label in 1–2, value at 34px serif in 3–10, arrow in 11–12. The `your-username` placeholders stay.
- [ ] **Step 4: Verify** — `npm test`, then all three pages in the browser, both modes.

---

### Task 7: Cross-cutting verification

**Files:**
- Modify: `app/e2e/*.spec.ts` as needed
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Playwright** — run `npm run test:e2e`; update `navigation.spec.ts` for the new `/projects/[slug]` hop and `theme.spec.ts` for the icon toggle. `a11y.spec.ts` must pass unchanged on every page including the new one; fix the page, not the assertion.
- [ ] **Step 2: Manual matrix** — every page × {light, dark} × {desktop, 390px} × {default, reduced motion}. This is the phase's real acceptance gate, per CLAUDE.md.
- [ ] **Step 3: Build** — `npm run build` with the Keystatic env vars; confirm no `fonts.gstatic.com` request at runtime and no new dependency in the bundle report.
- [ ] **Step 4: CHANGELOG** — one entry under `## [Unreleased]`, in this same branch.

---

## Out of scope

- Phase 3's 3D hero (shelved — spec §10).
- Recording the demo GIF; writing About/resume copy; real GitHub/LinkedIn URLs.
- Anything under `app/tools/bgm-looper/`, `lambda/`, or `infra/`.
- Deleting `TerminalWindow` — `CommandBar` still uses it.
