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

  it("opens with the masthead and carries the download bar in its right slot", () => {
    render(<ResumePage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Resume" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download pdf/i })).toHaveClass(
      "bg-fg",
      "hover:bg-accent",
      "motion-reduce:transition-none",
    );
  });

  it("lays each entry out on the shared grid: dates 1-2, role 3-8, bullets 9-12", () => {
    render(<ResumePage />);
    const entry = resume[0];
    const dates = screen.getByText(`${entry.start} — ${entry.end}`);
    expect(dates).toHaveClass("tabular-nums", "text-accent", "md:col-span-2");

    const row = dates.parentElement as HTMLElement;
    expect(row).toHaveClass("grid", "grid-cols-12", "gap-6", "border-b", "border-line");

    expect(screen.getByText(entry.role).parentElement).toHaveClass(
      "md:col-span-6",
      "md:col-start-3",
    );
    expect(screen.getByText(entry.bullets[0]).parentElement).toHaveClass(
      "md:col-span-4",
      "md:col-start-9",
    );
  });
});
