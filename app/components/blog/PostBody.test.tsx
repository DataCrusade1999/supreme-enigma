import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostBody } from "./PostBody";

describe("PostBody", () => {
  it("renders the title, date, and passed-in body content", () => {
    render(
      <PostBody title="Hello, World" date="2026-08-01">
        <p>This is the body.</p>
      </PostBody>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Hello, World" })).toBeInTheDocument();
    expect(screen.getByText("2026-08-01")).toBeInTheDocument();
    expect(screen.getByText("This is the body.")).toBeInTheDocument();
  });

  // Spec §2: two faces only. `--font-mono` is gone from the project theme, so
  // `font-mono` here would silently fall through to Tailwind's system mono
  // stack and leave /blog/[slug] on the pre-redesign typography.
  it("sets the post title in the display face and keeps mono off the date", () => {
    render(
      <PostBody title="Hello, World" date="2026-08-01">
        <p>This is the body.</p>
      </PostBody>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Hello, World" });
    expect(heading).toHaveClass("font-display");
    expect(heading).not.toHaveClass("font-mono");
    expect(screen.getByText("2026-08-01")).not.toHaveClass("font-mono");
  });
});
