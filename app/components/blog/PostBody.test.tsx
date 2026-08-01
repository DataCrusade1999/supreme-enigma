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
});
