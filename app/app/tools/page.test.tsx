import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ToolsPage from "./page";
import { TOOLS } from "../../lib/route-gate";

// CommandBar (rendered here because the hub sits outside the (site) group)
// calls useRouter, which has no app router mounted under jsdom.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("ToolsPage", () => {
  it("renders the hub heading", () => {
    render(<ToolsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Tools" })).toBeInTheDocument();
  });

  it("links to every tool in TOOLS, so a new entry there shows up here", () => {
    render(<ToolsPage />);
    for (const tool of TOOLS) {
      expect(screen.getByRole("link", { name: new RegExp(tool.name) })).toHaveAttribute(
        "href",
        tool.href,
      );
    }
  });

  it("prints each tool's blurb", () => {
    render(<ToolsPage />);
    for (const tool of TOOLS) {
      expect(screen.getByText(tool.blurb)).toBeInTheDocument();
    }
  });

  it("keeps a way back to the public site", () => {
    render(<ToolsPage />);
    expect(screen.getByRole("link", { name: "Ashutosh Pandey" })).toHaveAttribute("href", "/");
  });
});
