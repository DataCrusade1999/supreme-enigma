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

  it("keeps the your-username placeholders exactly as they are", () => {
    render(<ContactPage />);
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/your-username",
    );
    expect(screen.getByRole("link", { name: "LinkedIn" })).toHaveAttribute(
      "href",
      "https://linkedin.com/in/your-username",
    );
  });

  it("rules each channel across the grid: label 1-2, serif value 3-10, arrow 11-12", () => {
    render(<ContactPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Contact" }),
    ).toHaveClass("font-display");

    const label = screen.getByRole("link", { name: "Email" });
    expect(label.parentElement).toHaveClass("md:col-span-2");

    const value = screen.getByText("ashutosh.pandeyhlr007@gmail.com");
    expect(value).toHaveClass(
      "font-display",
      "text-[2.125rem]",
      "md:col-span-8",
      "md:col-start-3",
    );

    const row = value.parentElement as HTMLElement;
    expect(row).toHaveClass("grid", "grid-cols-12", "gap-6");
    expect(row.querySelector("[data-row-chevron]")).toHaveClass(
      "md:col-span-2",
      "md:col-start-11",
    );
  });
});
