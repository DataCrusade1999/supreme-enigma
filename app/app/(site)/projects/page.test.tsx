import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectsPage from "./page";

describe("ProjectsPage", () => {
  it("lists the BGM Looper project linking to the tool", () => {
    render(<ProjectsPage />);
    expect(screen.getByRole("link", { name: "BGM Looper" })).toHaveAttribute(
      "href",
      "/tools/bgm-looper",
    );
  });
});
