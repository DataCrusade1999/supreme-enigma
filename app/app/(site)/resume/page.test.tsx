import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/resume-content", () => ({ getPublishedResume: vi.fn() }));

import ResumePage from "./page";
import { getPublishedResume } from "@/lib/resume-content";

const PUBLISHED = {
  headline: { name: "Real Name", title: "Real Title", summary: "Real summary." },
  work: [
    {
      role: "QA Engineer",
      org: "Creowis",
      start: "July 2025",
      end: "Present",
      bullets: ["Built Playwright suites across a multi-tenant ERP."],
    },
  ],
  skills: [
    { group: "Languages", items: ["TypeScript", "Python"] },
    { group: "DevOps", items: ["Docker", "Terraform"] },
  ],
};

describe("ResumePage", () => {
  it("renders the published roles, dates, and bullets", async () => {
    vi.mocked(getPublishedResume).mockResolvedValue({ resume: PUBLISHED, published: true });

    render(await ResumePage());

    expect(screen.getByText("QA Engineer")).toBeInTheDocument();
    expect(screen.getByText("Creowis")).toBeInTheDocument();
    expect(screen.getByText(/July 2025/)).toBeInTheDocument();
    expect(
      screen.getByText("Built Playwright suites across a multi-tenant ERP."),
    ).toBeInTheDocument();
  });

  it("renders the skills section", async () => {
    vi.mocked(getPublishedResume).mockResolvedValue({ resume: PUBLISHED, published: true });

    render(await ResumePage());

    expect(screen.getByText("Languages")).toBeInTheDocument();
    expect(screen.getByText(/TypeScript/)).toBeInTheDocument();
    expect(screen.getByText("DevOps")).toBeInTheDocument();
  });

  it("shows the download link once a resume is published", async () => {
    vi.mocked(getPublishedResume).mockResolvedValue({ resume: PUBLISHED, published: true });

    render(await ResumePage());

    expect(screen.getByRole("link", { name: /download pdf/i })).toHaveAttribute(
      "href",
      "/resume.pdf",
    );
  });

  it("hides the download link before the first publish", async () => {
    // /resume.pdf 404s with nothing published. Offering a link to a 404 is
    // exactly the bug this closes (#76), so the link is conditional.
    vi.mocked(getPublishedResume).mockResolvedValue({
      resume: PUBLISHED,
      published: false,
    });

    render(await ResumePage());

    expect(screen.queryByRole("link", { name: /download pdf/i })).toBeNull();
  });
});
