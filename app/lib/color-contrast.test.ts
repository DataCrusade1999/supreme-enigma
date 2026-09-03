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
