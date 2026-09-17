import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TerminalWindow } from "./TerminalWindow";

describe("TerminalWindow", () => {
  it("renders the title bar and the content", () => {
    render(
      <TerminalWindow title="projects — zsh">
        <p>hello from inside</p>
      </TerminalWindow>,
    );

    expect(screen.getByText("projects — zsh")).toBeInTheDocument();
    expect(screen.getByText("hello from inside")).toBeInTheDocument();
  });
});
