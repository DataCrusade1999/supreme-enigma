import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "./page";
import { WAVE } from "../../content/wave-envelope";

describe("HomePage", () => {
  it("renders the name as the main heading", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Ashutosh Pandey" })).toBeInTheDocument();
  });

  it("lists the three pipeline settings with the values the Lambda actually uses", () => {
    render(<HomePage />);
    expect(screen.getByRole("row", { name: /Loudness target/ })).toHaveTextContent(
      "−14.0 LUFS",
    );
    expect(screen.getByRole("row", { name: /Crossfade/ })).toHaveTextContent("50 ms");
    expect(screen.getByRole("row", { name: /Silence trim/ })).toHaveTextContent(
      "top_db 40",
    );
  });

  it("draws one bar per entry in the shared envelope", () => {
    const { container } = render(<HomePage />);
    expect(container.querySelectorAll("[data-wave-bar]")).toHaveLength(WAVE.length);
  });

  it("calls out the head and the tail of the envelope", () => {
    render(<HomePage />);
    expect(screen.getByText("Head")).toBeInTheDocument();
    expect(screen.getByText("Tail")).toBeInTheDocument();
  });

  it("features the tool in the top band", () => {
    render(<HomePage />);
    expect(screen.getByText("Featured tool")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "BGM Looper" }),
    ).toBeInTheDocument();
  });

  it("links to the tool and to the project index", () => {
    render(<HomePage />);
    expect(screen.getByRole("link", { name: "Open the tool" })).toHaveAttribute(
      "href",
      "/tools/bgm-looper",
    );
    expect(screen.getByRole("link", { name: "All projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });
});
