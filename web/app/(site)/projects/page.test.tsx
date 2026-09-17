import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectsPage from "./page";

describe("ProjectsPage", () => {
  it("lists the BGM Looper project linking to its detail page", () => {
    render(<ProjectsPage />);
    expect(screen.getByRole("link", { name: "BGM Looper" })).toHaveAttribute(
      "href",
      "/projects/bgm-looper",
    );
  });

  it("numbers the rows and marks each with a chevron", () => {
    const { container } = render(<ProjectsPage />);
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-row-chevron]")).toHaveLength(1);
  });

  it("draws each row on the same gutter as the column rules", () => {
    const { container } = render(<ProjectsPage />);
    const rowGrid = container.querySelector("[data-row-chevron]")!.parentElement!;
    expect(rowGrid).toHaveClass("grid-cols-12", "gap-6");
  });
});
