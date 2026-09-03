import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import BlogPage from "./page";

describe("BlogPage", () => {
  it("renders the Blog heading and links to the seed post", async () => {
    const jsx = await BlogPage();
    render(jsx);
    expect(
      screen.getByRole("heading", { level: 1, name: "Blog" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hello, World" })).toHaveAttribute(
      "href",
      "/blog/hello-world",
    );
  });
});
