import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ResumePage from "./page";
import { resume } from "../../../content/resume";

describe("ResumePage", () => {
  it("renders a timeline entry for every resume item and a PDF download link", () => {
    render(<ResumePage />);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(resume.length);
    expect(screen.getByRole("link", { name: /download pdf/i })).toHaveAttribute(
      "href",
      "/resume.pdf",
    );
  });
});
