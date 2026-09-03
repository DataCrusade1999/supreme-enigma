import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color-contrast";

// Mirrors app/app/globals.css's portfolio-shell tokens. Keep in sync.
const LIGHT = {
  bg: "#eceae5",
  fg: "#111110",
  muted: "#5f5d57",
  accent: "#146b64",
  peak: "#a8362a",
  ruleHeavy: "#111110",
};

const DARK = {
  bg: "#131311",
  fg: "#eceae5",
  muted: "#9a968c",
  accent: "#5ec8c0",
  peak: "#e2574c",
};

// Terminal chrome is fixed-dark regardless of site theme, so it takes the
// dark-mode teal in both themes rather than following --color-accent.
const TERMINAL = {
  bg: "#0e1420",
  fg: "#d7deec",
  accent: "#5ec8c0",
};

const AA_NORMAL_TEXT = 4.5;
// Non-text contrast (WCAG 1.4.11) — the 2px rules are graphics, not type.
const AA_GRAPHIC = 3;

/** Flattens an alpha colour onto an opaque hex background. */
function flatten(
  [r, g, b]: [number, number, number],
  alpha: number,
  overHex: string,
): string {
  const clean = overHex.replace("#", "");
  return `#${[r, g, b]
    .map((channel, i) => {
      const under = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
      return Math.round(alpha * channel + (1 - alpha) * under)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

describe("portfolio color tokens meet WCAG AA", () => {
  it("light ink, muted, accent and peak pass against the light ground", () => {
    expect(contrastRatio(LIGHT.fg, LIGHT.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(LIGHT.muted, LIGHT.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(LIGHT.accent, LIGHT.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(LIGHT.peak, LIGHT.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("dark ink, muted, accent and peak pass against the dark ground", () => {
    expect(contrastRatio(DARK.fg, DARK.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(DARK.muted, DARK.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(DARK.accent, DARK.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(DARK.peak, DARK.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("action bar text passes on both its ink fill and its accent hover fill", () => {
    // The bar is ground-coloured text on an ink fill, going accent on hover.
    expect(contrastRatio(LIGHT.bg, LIGHT.fg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(LIGHT.bg, LIGHT.accent)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(DARK.bg, DARK.fg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(DARK.bg, DARK.accent)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("the dark 72% heavy rule stays distinguishable from the dark ground", () => {
    // --color-rule-heavy is rgba(236, 234, 229, 0.72) in dark mode: full-strength
    // ink vibrates at 2px on a dark ground. It is a graphic, so 3:1 is the bar.
    const darkRuleHeavy = flatten([236, 234, 229], 0.72, DARK.bg);
    expect(contrastRatio(darkRuleHeavy, DARK.bg)).toBeGreaterThanOrEqual(AA_GRAPHIC);
  });

  it("the light heavy rule is the full ink", () => {
    expect(contrastRatio(LIGHT.ruleHeavy, LIGHT.bg)).toBeGreaterThanOrEqual(AA_GRAPHIC);
  });

  it("terminal accent and fg pass against the fixed terminal bg", () => {
    expect(contrastRatio(TERMINAL.accent, TERMINAL.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(TERMINAL.fg, TERMINAL.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("the light accent would fail inside terminal chrome, which is why it is not used there", () => {
    expect(contrastRatio(LIGHT.accent, TERMINAL.bg)).toBeLessThan(AA_NORMAL_TEXT);
  });
});
