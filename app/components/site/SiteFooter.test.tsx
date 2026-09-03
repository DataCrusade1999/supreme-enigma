import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteFooter } from "./SiteFooter";

describe("SiteFooter", () => {
  it("renders the copyright line and tech stack", () => {
    render(<SiteFooter />);
    expect(
      screen.getByText(`© ${new Date().getFullYear()} Ashutosh Pandey`),
    ).toBeInTheDocument();
    expect(
      screen.getByText("next · vercel · aws lambda · python dsp"),
    ).toBeInTheDocument();
  });
});
