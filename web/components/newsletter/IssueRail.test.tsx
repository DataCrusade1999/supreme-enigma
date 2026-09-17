import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssueRail } from "./IssueRail";

const NEWER = { slug: "three-buckets", title: "Three branches, three buckets", date: "2026-09-12" };
const OLDER = { slug: "hello-newsletter", title: "Hello, newsletter", date: "2026-08-01" };

describe("IssueRail", () => {
  it("names the send date and links both neighbours", () => {
    render(<IssueRail sentDate="2026-08-24" newer={NEWER} older={OLDER} />);
    expect(screen.getByText("2026-08-24")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Three branches, three buckets" }),
    ).toHaveAttribute("href", "/newsletter/three-buckets");
    expect(screen.getByRole("link", { name: "Hello, newsletter" })).toHaveAttribute(
      "href",
      "/newsletter/hello-newsletter",
    );
  });

  // The newest issue has no newer neighbour and the oldest has no older one —
  // an absent slot must render nothing, not a dead link.
  it("omits a neighbour that does not exist", () => {
    render(<IssueRail sentDate="2026-09-12" newer={null} older={OLDER} />);
    expect(screen.queryByText(/Newer/)).not.toBeInTheDocument();
    expect(screen.getByText(/Older/)).toBeInTheDocument();
  });

  // The seed issue is the only issue. The rail still has a job (the send date
  // and the subscribe form); only the navigation block disappears.
  it("renders with no neighbours at all", () => {
    render(<IssueRail sentDate="2026-08-01" newer={null} older={null} />);
    expect(screen.getByText("2026-08-01")).toBeInTheDocument();
    expect(screen.queryByText("More issues")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });
});
