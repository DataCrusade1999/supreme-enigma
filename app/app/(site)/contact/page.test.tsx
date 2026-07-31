import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ContactPage from "./page";

describe("ContactPage", () => {
  it("renders a mailto link with the real email", () => {
    render(<ContactPage />);
    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute(
      "href",
      "mailto:ashutosh.pandeyhlr007@gmail.com",
    );
  });
});
