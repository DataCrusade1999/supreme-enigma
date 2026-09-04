import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";
import { COMMANDS } from "../../lib/site/commands";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.classList.add("dark");
    localStorage.clear();
  });

  it("names the mode the click will produce, not the current one", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Switch to light mode",
    );

    document.documentElement.classList.remove("dark");
    render(<ThemeToggle />);
    expect(screen.getAllByRole("button")[1]).toHaveAttribute(
      "aria-label",
      "Switch to dark mode",
    );
  });

  it("switches from dark to light and persists the choice", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("switches back from light to dark", () => {
    document.documentElement.classList.remove("dark");
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("stays in sync when the theme is changed externally via a command-bar command", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Switch to light mode");

    const themeLight = COMMANDS.find((command) => command.id === "theme-light");
    act(() => themeLight?.run({ push: vi.fn() }));

    expect(screen.getByRole("button")).toHaveAccessibleName("Switch to dark mode");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("transitions the rotation, not just the opacity, on the interaction curve", () => {
    // Tailwind v4 compiles `rotate-0`/`-rotate-90` to the standalone `rotate`
    // property, not to `transform`, so `rotate` has to be named in the
    // arbitrary transition list or the icon swap snaps instead of turning.
    const { container } = render(<ThemeToggle />);
    for (const icon of Array.from(container.querySelectorAll("svg"))) {
      expect(icon).toHaveClass("transition-[opacity,rotate]");
    }
  });
});
