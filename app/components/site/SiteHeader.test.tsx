import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SiteHeader } from "./SiteHeader";
import { openCommandBar } from "./CommandBar";

vi.mock("./CommandBar", () => ({
  openCommandBar: vi.fn(),
}));

describe("SiteHeader", () => {
  it("renders nav links and the BGM Looper CTA", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: "Resume" })).toHaveAttribute("href", "/resume");
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute("href", "/blog");
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
    expect(screen.getByRole("link", { name: "BGM Looper" })).toHaveAttribute(
      "href",
      "/tools/bgm-looper",
    );
  });

  it("opens the command bar when the trigger is clicked", () => {
    render(<SiteHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Open command bar" }));
    expect(openCommandBar).toHaveBeenCalledOnce();
  });

  it("gives every nav link a 44px hit target", () => {
    render(<SiteHeader />);
    for (const label of ["Home", "About", "Projects", "Resume", "Blog", "Contact"]) {
      expect(screen.getByRole("link", { name: label })).toHaveClass("min-h-11");
    }
  });
});
