import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectDemoGif } from "./ProjectDemoGif";

describe("ProjectDemoGif", () => {
  it("passes alt, width and height through", () => {
    render(
      <ProjectDemoGif
        src="/demos/example.gif"
        alt="BGM Looper trimming a track"
        width={1280}
        height={720}
      />,
    );

    const img = screen.getByRole("img", { name: "BGM Looper trimming a track" });
    expect(img).toHaveAttribute("src", "/demos/example.gif");
    expect(img).toHaveAttribute("width", "1280");
    expect(img).toHaveAttribute("height", "720");
  });

  it("lazy-loads by default", () => {
    render(
      <ProjectDemoGif src="/demos/example.gif" alt="Demo" width={1280} height={720} />,
    );

    expect(screen.getByRole("img", { name: "Demo" })).toHaveAttribute(
      "loading",
      "lazy",
    );
  });

  it("loads eagerly when priority is set", () => {
    render(
      <ProjectDemoGif
        src="/demos/example.gif"
        alt="Demo"
        width={1280}
        height={720}
        priority
      />,
    );

    expect(screen.getByRole("img", { name: "Demo" })).not.toHaveAttribute(
      "loading",
      "lazy",
    );
  });
});
