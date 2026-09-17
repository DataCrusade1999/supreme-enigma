import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssueBody } from "./IssueBody";

describe("IssueBody", () => {
  it("renders the title, date, and passed-in body content", () => {
    render(
      <IssueBody title="Hello, newsletter" date="2026-08-01">
        <p>This is the body.</p>
      </IssueBody>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Hello, newsletter" })).toBeInTheDocument();
    expect(screen.getByText("2026-08-01")).toBeInTheDocument();
    expect(screen.getByText("This is the body.")).toBeInTheDocument();
  });

  it("renders the rail beside the body when one is passed", () => {
    render(
      <IssueBody
        title="Hello, newsletter"
        date="2026-08-01"
        rail={<p>Rail content</p>}
      >
        <p>This is the body.</p>
      </IssueBody>,
    );
    expect(screen.getByText("Rail content")).toBeInTheDocument();
  });

  // `rail` is optional so the component still renders for an issue whose
  // neighbours and date are all absent — the body must never depend on it.
  it("renders without a rail", () => {
    render(
      <IssueBody title="Hello, newsletter" date="2026-08-01">
        <p>This is the body.</p>
      </IssueBody>,
    );
    expect(screen.getByText("This is the body.")).toBeInTheDocument();
  });
});
