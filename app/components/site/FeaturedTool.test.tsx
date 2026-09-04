import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeaturedTool } from "./FeaturedTool";
import { projects } from "../../content/projects";

const project = projects[0];

describe("FeaturedTool", () => {
  it("renders the project name as a heading linking to the tool", () => {
    render(<FeaturedTool project={project} />);

    expect(
      screen.getByRole("heading", { level: 2, name: project.name }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: project.name })).toHaveAttribute(
      "href",
      project.href,
    );
  });

  it("renders the description from the shared project data", () => {
    render(<FeaturedTool project={project} />);

    expect(screen.getByText(project.description)).toBeInTheDocument();
  });

  it("offers the tool and the how-it-works anchor as the two actions", () => {
    render(<FeaturedTool project={project} />);

    expect(screen.getByRole("link", { name: "Open the tool" })).toHaveAttribute(
      "href",
      project.href,
    );
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "/projects/bgm-looper#how-it-works",
    );
  });
});
