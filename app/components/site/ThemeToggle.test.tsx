import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";
import { COMMANDS } from "../../lib/site/commands";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.classList.add("dark");
    localStorage.clear();
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
    expect(screen.getByRole("button")).toHaveTextContent("Light mode");

    const themeLight = COMMANDS.find((command) => command.id === "theme-light");
    act(() => themeLight?.run({ push: vi.fn() }));

    expect(screen.getByRole("button")).toHaveTextContent("Dark mode");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
