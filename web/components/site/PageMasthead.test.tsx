import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageMasthead } from "./PageMasthead";

describe("PageMasthead", () => {
  it("renders the eyebrow and the title as the page heading", () => {
    render(<PageMasthead eyebrow="Section" title="Projects" />);

    expect(screen.getByText("Section")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
  });

  it("renders the right slot only when one is passed", () => {
    const { rerender } = render(<PageMasthead eyebrow="Section" title="Projects" />);
    expect(screen.queryByText("Open the tool")).not.toBeInTheDocument();

    rerender(
      <PageMasthead eyebrow="Section" title="Projects" right={<span>Open the tool</span>} />,
    );
    expect(screen.getByText("Open the tool")).toBeInTheDocument();
  });
});
