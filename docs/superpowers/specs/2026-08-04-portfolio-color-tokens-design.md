# Portfolio Color Tokens (UI Overhaul Phase 1) — Design Spec

Date: 2026-08-04

Full interactive research report (deep-research pass this phase and the
rest of the overhaul are based on): https://claude.ai/code/artifact/7361c63b-193d-4491-876f-03b7a1021daa

## 1. Purpose

First phase of a larger portfolio UI overhaul (terminal-style navigation,
a 3D hero, GIF-driven project demos — see `docs/superpowers/specs/` for
those follow-on specs once written). This phase covers only the color
system: replace the current warm amber/VU-meter accent with a cool teal,
and re-tint the secondary greys to match, so the palette reads as "cool
and soothing" per the site owner's request. Deep-research pass (6 search
angles, 24 sources) found that terminal-UI and dark-mode-for-developers
references consistently default to warm or neon accents (terracotta,
fluorescent green) — none proposed a cool-toned palette for this kind of
site, so the values below are assembled independently rather than lifted
from precedent.

Scoped to the whole app (portfolio pages and the bgm-looper tool/login
page share one token set today — confirmed by grep, no page hardcodes a
hex value outside `globals.css`). The owner chose not to fork a separate
palette for the tool; it takes the same teal accent as the rest of the
site.

## 2. Scope

Single file: `app/app/globals.css`. No component changes — every consumer
already reads the CSS custom properties (`var(--color-accent)`, etc.), so
the swap propagates without touching any `.tsx` file. No new dependencies,
no new routes, no new components.

`--color-bg`, `--color-surface`, `--color-fg`, and `--color-peak` are
unchanged — bg/surface/fg already sit close to what the research
recommends (soft near-black / off-white, not pure), and `peak` (error/
threshold red) stays a conventional warm red regardless of accent hue, by
the owner's explicit choice.

## 3. Token changes

```css
@theme {                          /* light (default) */
  --color-muted: #5b6478;   /* was #63625e — cool-tinted blue-grey */
  --color-line: #d3dae6;    /* was #dcdad4 — cool-tinted blue-grey */
  --color-accent: #1f8a82;  /* was #8a4b00 — teal */
}

:root.dark {
  --color-muted: #8894ac;   /* was #8f8d88 */
  --color-line: #253046;    /* was #26262b */
  --color-accent: #5ec8c0;  /* was #f0a202 */
}
```

The file's header comment (currently describing the palette as "anodised
graphite + the amber of a lit VU meter") is rewritten to describe the new
palette, since it documents the design intent and must stay accurate.

`--color-peak` values (`#a8362a` light, `#e2574c` dark) are unchanged.

## 4. Verification

- **Contrast (WCAG AA):** check both new accent values against their
  paired `bg`/`surface`, and both new `muted` values against `bg`, in
  both themes. Target: ≥4.5:1 for text use (accent is used for links and
  focus-ring color, muted for secondary body text), ≥3:1 for non-text UI
  (borders, the focus outline itself). If a value fails, adjust lightness
  slightly toward the failing direction — hue stays teal/blue-grey either
  way.
- **Visual pass:** every `(site)` page (`/`, `/about`, `/projects`,
  `/resume`, `/contact`, `/blog`) plus `/tools/bgm-looper/login`, in both
  light and dark (via the existing theme toggle), confirming no element
  still reads as amber/warm and no text becomes hard to read against the
  new muted/line values.
- **Automated tests:** `cd app && npm test` — this change touches no
  component logic, but confirms nothing snapshot-asserts the old hex
  values.

No error-handling or data-flow section applies — this is a constant-value
change in one CSS file, nothing executes differently at runtime.

## 5. Out of scope

- Terminal-style navigation/chrome, the 3D hero, and GIF-driven project
  demos — separate follow-on phases, each gets its own design spec before
  implementation.
- Any change to `--color-bg`, `--color-surface`, `--color-fg`, or
  `--color-peak`.
- Any component or layout restructuring — this phase is tokens only.
