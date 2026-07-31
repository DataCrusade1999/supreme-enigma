import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the name as the main heading", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Ashutosh Pandey" })).toBeInTheDocument();
  });
});
