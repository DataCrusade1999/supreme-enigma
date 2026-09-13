import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/resume-content", () => ({ getPublishedResume: vi.fn() }));

import AboutPage from "./page";
import { getPublishedResume } from "@/lib/resume-content";

const RESUME = {
  headline: {
    name: "Real Name",
    title: "QA Engineer & DevOps Operator",
    summary: "Builds reliable systems and removes manual toil.",
  },
  work: [{ role: "R", org: "O", start: "2025", end: "Present", bullets: ["b"] }],
  skills: [{ group: "Languages", items: ["TypeScript"] }],
};

describe("AboutPage", () => {
  it("renders the published title and summary", async () => {
    vi.mocked(getPublishedResume).mockResolvedValue({ resume: RESUME, published: true });

    render(await AboutPage());

    expect(screen.getByText("QA Engineer & DevOps Operator")).toBeInTheDocument();
    expect(
      screen.getByText("Builds reliable systems and removes manual toil."),
    ).toBeInTheDocument();
  });

  it("still renders before the first publish", async () => {
    // The page must not error or go blank when nothing is published — it is
    // the live state of production until the first publish.
    vi.mocked(getPublishedResume).mockResolvedValue({
      resume: RESUME,
      published: false,
    });

    render(await AboutPage());

    expect(screen.getByText("About")).toBeInTheDocument();
  });
});
