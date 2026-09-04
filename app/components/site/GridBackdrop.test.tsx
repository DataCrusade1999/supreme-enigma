import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { GridBackdrop } from "./GridBackdrop";

describe("GridBackdrop", () => {
  it("renders the twelve column rules, hidden from assistive tech", () => {
    const { container } = render(<GridBackdrop />);
    const backdrop = container.firstElementChild as HTMLElement;

    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(backdrop.querySelectorAll("[data-column-rule]")).toHaveLength(12);
  });

  it("does not trap pointer events", () => {
    const { container } = render(<GridBackdrop />);
    expect(container.firstElementChild).toHaveClass("pointer-events-none");
  });
});
