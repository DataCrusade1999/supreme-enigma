import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteFooter } from "./SiteFooter";

describe("SiteFooter", () => {
  it("renders the copyright line and tech stack", () => {
    render(<SiteFooter />);
    expect(
      screen.getByText(`© ${new Date().getFullYear()} Ashutosh Pandey`),
    ).toBeInTheDocument();
    // The stack is a wrapping list now, so each item is its own element rather
    // than one interpunct-joined string.
    for (const item of ["next", "vercel", "aws lambda", "python dsp"]) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
