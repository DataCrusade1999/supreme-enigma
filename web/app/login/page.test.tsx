import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LoginPage from "./page";

let mockSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    mockSearch = "";
  });

  it("links to the sign-in route, carrying next", () => {
    mockSearch = "next=%2Fkeystatic%3Fpath%3Dposts";
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/auth/login?next=%2Fkeystatic%3Fpath%3Dposts",
    );
  });

  it("sends a visit with no next to the hub", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/auth/login?next=%2Ftools",
    );
  });

  it("does not carry an off-site next into the link", () => {
    mockSearch = "next=https%3A%2F%2Fevil.example";
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/auth/login?next=%2Ftools",
    );
  });

  it.each([
    ["state", "That sign-in expired or came from another tab. Try again."],
    ["denied", "Sign-in was cancelled."],
    ["not-allowed", "That account can't open these tools."],
    ["failed", "Sign-in failed. Try again."],
  ])("explains error=%s", (code, message) => {
    mockSearch = `error=${code}`;
    render(<LoginPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it("opens the command bar on Ctrl+K", () => {
    render(<LoginPage />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Command bar" })).toBeInTheDocument();
  });

  it("names the tool the visitor was heading to", () => {
    mockSearch = "next=%2Ftools%2Fbgm-looper";
    render(<LoginPage />);
    expect(screen.getByText("Continuing to")).toBeInTheDocument();
    expect(screen.getByText("BGM Looper")).toBeInTheDocument();
  });

  // The strip reads the pathname, the link keeps the whole thing — a query or
  // hash after the prefix must not cost the visitor the strip.
  it.each([
    ["a query", "next=%2Fkeystatic%3Fpath%3Dposts", "/keystatic?path=posts", "Content editor"],
    ["a hash", "next=%2Ftools%2Fbgm-looper%23top", "/tools/bgm-looper#top", "BGM Looper"],
  ])("names the tool and keeps %s in the sign-in link", (_label, search, target, name) => {
    mockSearch = search;
    render(<LoginPage />);
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/api/auth/login?next=${encodeURIComponent(target)}`,
    );
  });

  it.each([
    ["next is missing", ""],
    ["next names no known tool", "next=%2Fsomewhere-else"],
    ["next is off-origin", "next=https%3A%2F%2Fevil.example"],
  ])("drops the destination strip when %s", (_label, search) => {
    mockSearch = search;
    render(<LoginPage />);
    expect(screen.queryByText("Continuing to")).not.toBeInTheDocument();
  });
});
