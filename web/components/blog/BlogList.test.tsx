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

  it("shares the projects row rhythm: date 1-2, serif title 3-9, tags right 10-12", () => {
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
    const date = screen.getByText("2026-08-01");
    expect(date).toHaveClass("tabular-nums", "text-accent", "md:col-span-2");
    expect(date.parentElement).toHaveClass("grid", "grid-cols-12", "gap-6");

    const title = screen.getByRole("link", { name: "Hello, World" });
    expect(title.parentElement).toHaveClass("font-display");
    expect(title.closest("div")).toHaveClass("md:col-span-7", "md:col-start-3");

    expect(screen.getByText("#meta").parentElement).toHaveClass(
      "md:col-span-3",
      "md:col-start-10",
      "md:justify-end",
    );
  });
});
