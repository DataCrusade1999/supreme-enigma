import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CommandBarTrigger } from "./CommandBarTrigger";
import { openCommandBar } from "./CommandBar";

vi.mock("./CommandBar", () => ({
  openCommandBar: vi.fn(),
}));

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value,
    configurable: true,
  });
}

const originalUserAgent = window.navigator.userAgent;

afterEach(() => {
  setUserAgent(originalUserAgent);
});

describe("CommandBarTrigger", () => {
  it("calls openCommandBar with its own element when clicked", () => {
    render(<CommandBarTrigger />);
    const button = screen.getByRole("button", { name: "Open command bar" });
    fireEvent.click(button);
    expect(openCommandBar).toHaveBeenCalledOnce();
    expect(openCommandBar).toHaveBeenCalledWith(button);
  });

  it("shows the ⌘K glyph on macOS", () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    );
    render(<CommandBarTrigger />);
    act(() => {});
    expect(screen.getByRole("button", { name: "Open command bar" })).toHaveTextContent("⌘K");
  });

  it("shows Ctrl K on Windows", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    render(<CommandBarTrigger />);
    act(() => {});
    expect(screen.getByRole("button", { name: "Open command bar" })).toHaveTextContent("Ctrl K");
  });

  it("uses the shell's UI face and a 44px hit target", () => {
    render(<CommandBarTrigger />);
    const button = screen.getByRole("button", { name: "Open command bar" });
    // Spec §2: no third face. `--font-mono` is gone from the project theme,
    // so `font-mono` would fall through to Tailwind's own system mono stack.
    expect(button).not.toHaveClass("font-mono");
    expect(button).toHaveClass("min-h-11");
  });
});
