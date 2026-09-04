import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AboutPage from "./page";
import { WAVE } from "../../../content/wave-envelope";

describe("AboutPage", () => {
  it("renders an About heading", () => {
    render(<AboutPage />);
    expect(screen.getByRole("heading", { level: 1, name: "About" })).toBeInTheDocument();
  });

  it("keeps the placeholder copy visible and unchanged", () => {
    render(<AboutPage />);
    expect(
      screen.getByText(
        "Replace this paragraph with your real background, skills, and interests.",
      ),
    ).toBeInTheDocument();
  });

  it("draws the LoopRing beside the copy", () => {
    const { container } = render(<AboutPage />);
    expect(container.querySelectorAll("[data-ring-bar]")).toHaveLength(WAVE.length);
  });

  it("lists the metadata beneath the ring", () => {
    render(<AboutPage />);
    expect(screen.getByText("Based in")).toBeInTheDocument();
    expect(screen.getByText("Currently")).toBeInTheDocument();
  });
});
