import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ToolsPage from "./page";
import { TOOLS } from "../../lib/route-gate";

// CommandBar (rendered here because the hub sits outside the (site) group)
// calls useRouter, which has no app router mounted under jsdom.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// An async server component: resolve its JSX first, then render (TESTING.md).
const hub = (query: Record<string, string> = {}) => ToolsPage({ searchParams: Promise.resolve(query) });

describe("ToolsPage", () => {
  it("renders the hub heading", async () => {
    render(await hub());
    expect(screen.getByRole("heading", { level: 1, name: "Tools" })).toBeInTheDocument();
  });

  it("links to every tool in TOOLS, so a new entry there shows up here", async () => {
    render(await hub());
    for (const tool of TOOLS) {
      expect(screen.getByRole("link", { name: new RegExp(tool.name) })).toHaveAttribute(
        "href",
        tool.href,
      );
    }
  });

  it("prints each tool's blurb", async () => {
    render(await hub());
    for (const tool of TOOLS) {
      expect(screen.getByText(tool.blurb)).toBeInTheDocument();
    }
  });

  it("keeps a way back to the public site", async () => {
    render(await hub());
    expect(screen.getByRole("link", { name: "Ashutosh Pandey" })).toHaveAttribute("href", "/");
  });

  it("links to passkey setup through a fresh sign-in, so Cognito has a session to add it to", async () => {
    render(await hub());
    expect(screen.getByRole("link", { name: "Add a passkey" })).toHaveAttribute(
      "href",
      "/api/auth/login?next=%2Fapi%2Fauth%2Fpasskey",
    );
  });

  it.each([
    ["added", "Passkey added. Use it the next time you sign in."],
    ["failed", "The passkey was not added."],
  ])("reports passkey=%s", async (passkey, message) => {
    render(await hub({ passkey }));
    expect(screen.getByRole("status")).toHaveTextContent(message);
  });

  it("shows no passkey message otherwise", async () => {
    render(await hub({ passkey: "anything" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
