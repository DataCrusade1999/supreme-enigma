# Portfolio Color Tokens (UI Overhaul Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the portfolio app's warm amber/VU-meter accent with a cool teal, and re-tint the secondary greys, while keeping WCAG AA contrast intact — a pure CSS custom-property change, verified by a new automated contrast-ratio check.

**Architecture:** One new small utility (`contrastRatio`) computes WCAG relative-luminance contrast from two hex strings. A regression test asserts the new token pairs meet AA thresholds using hardcoded hex constants that mirror `globals.css`. Then `globals.css` itself is updated to those exact values — no component changes, since every consumer already reads the CSS custom properties.

**Tech Stack:** TypeScript, Vitest (existing test runner), Tailwind CSS v4 (CSS-first `@theme` tokens in `app/app/globals.css`).

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-08-04-portfolio-color-tokens-design.md`.
- Only `app/app/globals.css` and the new contrast-check files change — no `.tsx` files, no new dependencies.
- `--color-bg`, `--color-surface`, `--color-fg`, `--color-peak` (both themes) stay exactly as they are today — unchanged.
- Every new/changed color pair must hit WCAG AA: contrast ratio ≥ 4.5:1 (per spec §4).
- `cd app && npm test` must pass after every task.

---

### Task 1: `contrastRatio` utility + its own tests

**Files:**
- Create: `app/lib/color-contrast.ts`
- Test: `app/lib/color-contrast.test.ts`

**Interfaces:**
- Produces: `contrastRatio(hexA: string, hexB: string): number` — exported function. `hexA`/`hexB` are 6-digit hex strings with a leading `#` (e.g. `"#1f8a82"`). Returns the WCAG contrast ratio (a number ≥ 1, e.g. `21` for pure black vs pure white), symmetric in its two arguments.

- [ ] **Step 1: Write the failing tests**

```typescript
// app/lib/color-contrast.test.ts
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color-contrast";

describe("contrastRatio", () => {
  it("returns 21 for pure black vs pure white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("returns 1 for identical colors", () => {
    expect(contrastRatio("#5b6478", "#5b6478")).toBeCloseTo(1, 5);
  });

  it("is symmetric in its two arguments", () => {
    const ab = contrastRatio("#1f8a82", "#f4f4f2");
    const ba = contrastRatio("#f4f4f2", "#1f8a82");
    expect(ab).toBeCloseTo(ba, 10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run lib/color-contrast.test.ts`
Expected: FAIL — `color-contrast.ts` does not exist yet (`Cannot find module './color-contrast'`).

- [ ] **Step 3: Write the implementation**

```typescript
// app/lib/color-contrast.ts
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/**
 * WCAG 2.x contrast ratio between two hex colors, from 1 (no contrast)
 * to 21 (black vs white). Symmetric in its two arguments.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexA);
  const luminanceB = relativeLuminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run lib/color-contrast.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd app && git add lib/color-contrast.ts lib/color-contrast.test.ts
git commit -m "$(cat <<'EOF'
test: add WCAG contrast-ratio utility

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 2: Token-contrast regression test

**Files:**
- Create: `app/lib/portfolio-tokens.test.ts`

**Interfaces:**
- Consumes: `contrastRatio` from `./color-contrast` (Task 1).
- Produces: nothing new — this is a pure regression test. It hardcodes the target hex values as local constants (mirroring `app/app/globals.css`, which Task 3 updates to match) — CSS custom properties can't be imported into a Vitest/jsdom test directly, so this file is the source of truth the CSS must match, not the other way around. If `globals.css`'s token values ever change, this test's constants must be updated too — that coupling is intentional, not a gap.

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/portfolio-tokens.test.ts
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color-contrast";

// Mirrors app/app/globals.css's portfolio-shell tokens. Keep in sync.
const LIGHT = {
  bg: "#f4f4f2",
  surface: "#ffffff",
  accent: "#187a73",
  muted: "#5b6478",
};

const DARK = {
  bg: "#0b0b0d",
  surface: "#131317",
  accent: "#5ec8c0",
  muted: "#8894ac",
};

const AA_NORMAL_TEXT = 4.5;

describe("portfolio color tokens meet WCAG AA", () => {
  it("light accent passes against bg and surface", () => {
    expect(contrastRatio(LIGHT.accent, LIGHT.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(LIGHT.accent, LIGHT.surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("light muted passes against bg", () => {
    expect(contrastRatio(LIGHT.muted, LIGHT.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("dark accent passes against bg and surface", () => {
    expect(contrastRatio(DARK.accent, DARK.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(DARK.accent, DARK.surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("dark muted passes against bg", () => {
    expect(contrastRatio(DARK.muted, DARK.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
```

Note: the light accent constant above (`#187a73`) is already the
AA-corrected value, not the spec's original `#1f8a82` proposal —
`#1f8a82` measures ~3.8-4.2:1 against `#f4f4f2`/`#ffffff` (fails the
4.5:1 AA threshold for normal text; the header CTA button in
`SiteHeader.tsx` renders small bold text directly on the accent
background, which requires the normal-text threshold, not the relaxed
3:1 large-text one). `#187a73` is the same hue, darkened until it
clears 4.5:1 against both light backgrounds — this is the "if a value
fails, adjust lightness toward the failing direction" case the design
spec's §4 anticipated. Dark-mode `#5ec8c0` already clears AA
comfortably (~9:1) and is unchanged from the spec.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run lib/portfolio-tokens.test.ts`
Expected: PASS actually — the constants above already use the
corrected value, so this test should pass immediately once Task 1's
`contrastRatio` exists. (Unlike most tasks in this plan, there is no
"red" state to observe here: the test asserts a property of fixed
constants, not of not-yet-written implementation code. Skip to Step 3.)

- [ ] **Step 3: Run the test to confirm it's green**

Run: `cd app && npx vitest run lib/portfolio-tokens.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
cd app && git add lib/portfolio-tokens.test.ts
git commit -m "$(cat <<'EOF'
test: verify portfolio color tokens meet WCAG AA contrast

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 3: Update `globals.css` tokens

**Files:**
- Modify: `app/app/globals.css:1-32`

**Interfaces:**
- Consumes: nothing (pure CSS values) — but the hex values used here MUST match `LIGHT`/`DARK` in Task 2's `portfolio-tokens.test.ts` exactly, since that test is the contrast regression guard for these values.
- Produces: `--color-accent`, `--color-muted`, `--color-line` (both `@theme` and `:root.dark` blocks) — consumed by every existing component via Tailwind's generated utilities (`text-accent`, `bg-accent`, `border-line`, `text-muted`, etc.) and by the `::selection`/`:focus-visible` rules already in this file.

- [ ] **Step 1: Replace the token values and header comment**

Change the top of `app/app/globals.css` from:

```css
/*
 * Palette: anodised graphite + the amber of a lit VU meter, with a peak-hold
 * red reserved for signal that crosses the threshold. Every token below is
 * declared in BOTH blocks (light default in @theme, dark override in
 * :root.dark) so neither mode can silently fall back to the other's value.
 */
@theme {
  --color-bg: #f4f4f2;
  --color-surface: #ffffff;
  --color-fg: #16161a;
  --color-muted: #63625e;
  --color-line: #dcdad4;
  --color-accent: #8a4b00;
  --color-peak: #a8362a;

  --font-mono: ui-monospace, "SFMono-Regular", "Cascadia Mono", "Segoe UI Mono",
    Menlo, Consolas, "Liberation Mono", monospace;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
}

:root.dark {
  --color-bg: #0b0b0d;
  --color-surface: #131317;
  --color-fg: #e8e6e2;
  --color-muted: #8f8d88;
  --color-line: #26262b;
  --color-accent: #f0a202;
  --color-peak: #e2574c;
}
```

to:

```css
/*
 * Palette: soft graphite neutrals with a cool teal accent, and a peak-hold
 * red reserved for signal that crosses the threshold. Every token below is
 * declared in BOTH blocks (light default in @theme, dark override in
 * :root.dark) so neither mode can silently fall back to the other's value.
 */
@theme {
  --color-bg: #f4f4f2;
  --color-surface: #ffffff;
  --color-fg: #16161a;
  --color-muted: #5b6478;
  --color-line: #d3dae6;
  --color-accent: #187a73;
  --color-peak: #a8362a;

  --font-mono: ui-monospace, "SFMono-Regular", "Cascadia Mono", "Segoe UI Mono",
    Menlo, Consolas, "Liberation Mono", monospace;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
}

:root.dark {
  --color-bg: #0b0b0d;
  --color-surface: #131317;
  --color-fg: #e8e6e2;
  --color-muted: #8894ac;
  --color-line: #253046;
  --color-accent: #5ec8c0;
  --color-peak: #e2574c;
}
```

(Everything below the `:root.dark` block — `html`, `body`, `h1,h2,h3`,
`p`, `::selection`, `:focus-visible`, the `@keyframes playhead` rule, and
the `prefers-reduced-motion` override — is unchanged.)

- [ ] **Step 2: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS — all existing tests plus Tasks 1 and 2's new tests.

- [ ] **Step 3: Commit**

```bash
cd app && git add app/globals.css
git commit -m "$(cat <<'EOF'
style: swap portfolio accent from amber to teal, cool-tint neutrals

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 4: Manual visual verification

**Files:** none (verification only — no code changes).

**Interfaces:** none.

This step exists because color changes need eyes on them — the contrast
math from Tasks 1-3 guarantees the numbers pass AA, not that the page
still looks right. Per this project's CLAUDE.md convention, frontend
changes are verified in a running instance, not assumed correct from
tests alone.

- [ ] **Step 1: Start the dev server**

Run: `cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev`

- [ ] **Step 2: Visually check every page in both themes**

Open, in both light and dark (use the header's theme-toggle button to
switch): `/`, `/about`, `/projects`, `/resume`, `/blog`, `/contact`,
`/tools/bgm-looper/login`. Confirm for each:
- No element still reads as amber/warm-orange.
- Body text (`text-fg`), secondary text (`text-muted`), and borders
  (`border-line`) are all comfortably legible.
- The `BGM Looper` CTA button in the header (accent background, `text-bg`
  text) is legible in both themes.
- The text-selection highlight (`::selection`) and the keyboard focus
  ring (`:focus-visible`, tab through the header nav to see it) both use
  the new teal, not amber.

- [ ] **Step 3: Stop the dev server**

Ctrl+C in the terminal running `npm run dev`.

No commit for this task — it's a verification-only step with no file
changes. If the visual pass surfaces a problem, fix it by amending the
hex values in `app/app/globals.css` AND `app/lib/portfolio-tokens.test.ts`
together (they must stay in sync, per Task 2's note), then re-run Task 3
Step 2 and this task before continuing.

---

## Self-Review Notes

- **Spec coverage:** §3 (token changes) → Task 3. §4 (contrast
  verification) → Tasks 1-2 (automated) and Task 4 (visual). §5 (out of
  scope: no component changes) → confirmed, no `.tsx` file appears in
  any task's file list.
- **Type consistency:** `contrastRatio(hexA: string, hexB: string):
  number` is defined once in Task 1 and consumed with that exact
  signature in Task 2 — no drift.
- **No placeholders:** all code blocks are complete and runnable as
  written; the light-mode accent's contrast-driven adjustment
  (`#1f8a82` → `#187a73`) is computed and stated explicitly, not left as
  a "check and adjust" placeholder.
