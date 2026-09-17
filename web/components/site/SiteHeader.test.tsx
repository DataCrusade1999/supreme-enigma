import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "./SiteHeader";

describe("SiteHeader", () => {
  it("renders nav links and the BGM Looper CTA", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: "Resume" })).toHaveAttribute("href", "/resume");
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute("href", "/blog");
    expect(screen.getByRole("link", { name: "Newsletter" })).toHaveAttribute(
      "href",
      "/newsletter",
    );
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
    expect(screen.getByRole("link", { name: "BGM Looper" })).toHaveAttribute(
      "href",
      "/tools/bgm-looper",
    );
  });

  // The command bar itself stays — Ctrl/Cmd+K still opens it everywhere. Only
  // the header's visible affordance is gone, so the shortcut is unadvertised
  // rather than removed.
  it("advertises no command bar shortcut", () => {
    render(<SiteHeader />);
    expect(screen.queryByRole("button", { name: "Open command bar" })).toBeNull();
    expect(screen.queryByText(/⌘K|Ctrl K/)).toBeNull();
  });

  it("gives every nav link a 44px hit target", () => {
    render(<SiteHeader />);
    for (const label of [
      "Home",
      "About",
      "Projects",
      "Resume",
      "Blog",
      "Newsletter",
      "Contact",
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveClass("min-h-11");
    }
  });
});
