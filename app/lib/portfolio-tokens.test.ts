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

// Terminal chrome is fixed-dark regardless of site theme, so it takes the
// dark-mode teal in both themes rather than following --color-accent.
const TERMINAL = {
  bg: "#0e1420",
  fg: "#d7deec",
  accent: "#5ec8c0",
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

  it("terminal accent and fg pass against the fixed terminal bg", () => {
    expect(contrastRatio(TERMINAL.accent, TERMINAL.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(TERMINAL.fg, TERMINAL.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("the light accent would fail inside terminal chrome, which is why it is not used there", () => {
    expect(contrastRatio(LIGHT.accent, TERMINAL.bg)).toBeLessThan(AA_NORMAL_TEXT);
  });
});
