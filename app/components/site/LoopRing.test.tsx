import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoopRing } from "./LoopRing";
import { HEAD, PEAK, WAVE } from "../../content/wave-envelope";

// Vitest's root is `app/`, so the stylesheet is a fixed path from there.
const GLOBALS_CSS = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

function bars(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-ring-bar]"));
}

describe("LoopRing", () => {
  it("draws one bar per entry in the shared envelope, however long it is", () => {
    const { container } = render(<LoopRing />);
    expect(bars(container)).toHaveLength(WAVE.length);
  });

  it("places bar i at -90deg + i * (360/n) so index 0 sits at twelve o'clock", () => {
    const { container } = render(<LoopRing radius={100} />);
    const step = 360 / WAVE.length;

    expect(bars(container)[0].style.transform).toContain("rotate(-90deg)");
    expect(bars(container)[0].style.transform).toContain("translateX(100px)");
    expect(bars(container)[1].style.transform).toContain(`rotate(${-90 + step}deg)`);
    // The wrapper shrink-wraps its bar, so without this the rotation would be
    // about each bar's own midpoint rather than the ring's centre.
    expect(bars(container)[0]).toHaveClass("origin-top-left");
  });

  it("scales bar length off the envelope value", () => {
    const { container } = render(<LoopRing scale={2} />);
    expect(bars(container)[3].firstElementChild).toHaveStyle({
      width: `${WAVE[3] * 2}px`,
    });
  });

  it("colours head, tail, peaks and body by the same rules as the linear figure", () => {
    const { container } = render(<LoopRing />);
    const colour = (index: number) =>
      bars(container)[index].firstElementChild?.className ?? "";

    for (let index = 0; index < HEAD.length; index += 1) {
      expect(colour(index)).toContain("bg-accent");
      expect(colour(WAVE.length - 1 - index)).toContain("bg-accent");
    }

    const peak = WAVE.findIndex(
      (height, index) => height >= PEAK && index >= HEAD.length,
    );
    expect(colour(peak)).toContain("bg-peak");

    const body = WAVE.findIndex(
      (height, index) => height < PEAK && index >= HEAD.length,
    );
    expect(colour(body)).toContain("bg-fg/25");
  });

  it("renders the sweeping hand and the seam mark", () => {
    const { container } = render(<LoopRing />);
    expect(container.querySelector("[data-ring-hand]")).toHaveClass("ring-hand");
    expect(screen.getByText("Tail → head")).toHaveClass("ring-seam");
  });

  // jsdom applies no stylesheet, so the reduced-motion switch is asserted where
  // it actually lives — the globals.css rules beside .playhead — plus the class
  // names that link the markup to them, so a rename can't silently break it.
  it("parks the hand and keeps the seam mark visible under prefers-reduced-motion", () => {
    const reduced = GLOBALS_CSS.split("@media (prefers-reduced-motion: reduce)");
    expect(reduced.some((block) => /\.ring-hand\s*{[^}]*animation:\s*none/.test(block))).toBe(
      true,
    );
    expect(
      reduced.some((block) => /\.ring-seam\s*{[^}]*animation:\s*none;[^}]*opacity:\s*1/.test(block)),
    ).toBe(true);
  });
});
