import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlogList } from "./BlogList";

describe("BlogList", () => {
  it("renders each post linking to /blog/[slug]", () => {
    render(
      <BlogList
        posts={[
          {
            slug: "hello-world",
            title: "Hello, World",
            date: "2026-08-01",
            summary: "First post.",
            tags: ["meta"],
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Hello, World" })).toHaveAttribute(
      "href",
      "/blog/hello-world",
    );
    expect(screen.getByText("First post.")).toBeInTheDocument();
    expect(screen.getByText("#meta")).toBeInTheDocument();
  });
});
