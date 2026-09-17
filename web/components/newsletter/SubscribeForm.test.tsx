import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubscribeForm } from "./SubscribeForm";

describe("SubscribeForm", () => {
  it("renders a form posting to Buttondown's embed-subscribe endpoint with an email input", () => {
    render(<SubscribeForm />);
    const form = screen.getByRole("form", { name: "Subscribe to the newsletter" });
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute(
      "action",
      expect.stringContaining("buttondown.com/api/emails/embed-subscribe/"),
    );
    expect(screen.getByPlaceholderText("you@example.com")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });

  // The rail variant is the same form in a narrower column — same action, same
  // labelled input, same button. Only the spacing differs, which is why this is
  // one component with a prop rather than two components that can drift apart.
  it("renders the same form in the rail variant", () => {
    render(<SubscribeForm variant="rail" />);
    const form = screen.getByRole("form", { name: "Subscribe to the newsletter" });
    expect(form).toHaveAttribute(
      "action",
      expect.stringContaining("buttondown.com/api/emails/embed-subscribe/"),
    );
    expect(screen.getByPlaceholderText("you@example.com")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });
});
