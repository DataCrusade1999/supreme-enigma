// app/components/site/CommandBar.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CommandBar, openCommandBar } from "./CommandBar";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe("CommandBar", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("is closed by default", () => {
    render(<CommandBar />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on Ctrl+K", () => {
    render(<CommandBar />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens when openCommandBar() is called externally", () => {
    render(<CommandBar />);
    act(() => openCommandBar());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("filters the command list as you type and navigates on Enter", () => {
    render(<CommandBar />);
    act(() => openCommandBar());

    const input = screen.getByLabelText("Command");
    fireEvent.change(input, { target: { value: "resume" } });

    expect(screen.getByText("cd resume")).toBeInTheDocument();
    expect(screen.queryByText("cd about")).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/resume");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves selection with arrow keys before running on Enter", () => {
    render(<CommandBar />);
    act(() => openCommandBar());

    const input = screen.getByLabelText("Command");
    // First command is "cd home" (-> "/"); one ArrowDown selects "cd about".
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/about");
  });

  it("closes on Escape and returns focus to whatever was focused before opening", () => {
    render(
      <>
        <button>trigger</button>
        <CommandBar />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "trigger" });
    trigger.focus();

    act(() => openCommandBar());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("Command"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("ignores a repeat Ctrl+K while already open, preserving the typed query and focus-restore target", () => {
    render(
      <>
        <button>trigger</button>
        <CommandBar />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "trigger" });
    trigger.focus();

    act(() => openCommandBar());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const input = screen.getByLabelText("Command");
    fireEvent.change(input, { target: { value: "resume" } });
    expect(input).toHaveValue("resume");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(input).toHaveValue("resume");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("restores focus to an explicitly-passed trigger even when it wasn't document.activeElement (Safari mouse-click quirk)", () => {
    render(
      <>
        <button>trigger</button>
        <CommandBar />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "trigger" });
    // Deliberately do NOT focus the trigger — Safari doesn't move focus to a
    // <button> on mouse click, so document.activeElement stays elsewhere.
    document.body.focus();

    act(() => openCommandBar(trigger));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("Command"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("locks body scroll while open and restores it on close", () => {
    render(<CommandBar />);
    const previousOverflow = document.body.style.overflow;

    act(() => openCommandBar());
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(screen.getByLabelText("Command"), { key: "Escape" });
    expect(document.body.style.overflow).toBe(previousOverflow);
  });

  it("wraps Tab focus from the last element back to the input", () => {
    render(<CommandBar />);
    act(() => openCommandBar());

    const input = screen.getByLabelText("Command");
    expect(input).toHaveFocus();

    const buttons = screen.getAllByRole("button");
    const lastCommandButton = buttons[buttons.length - 1];
    lastCommandButton.focus();

    fireEvent.keyDown(lastCommandButton, { key: "Tab" });
    expect(input).toHaveFocus();
  });
});
