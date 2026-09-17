import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssueList } from "./IssueList";

describe("IssueList", () => {
  it("renders each issue linking to /newsletter/[slug]", () => {
    render(
      <IssueList
        issues={[
          {
            slug: "hello-newsletter",
            title: "Hello, newsletter",
            date: "2026-08-01",
            summary: "First issue.",
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Hello, newsletter" })).toHaveAttribute(
      "href",
      "/newsletter/hello-newsletter",
    );
    expect(screen.getByText("First issue.")).toBeInTheDocument();
  });
});
