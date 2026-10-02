import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AccessDeniedPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const page = (query: Record<string, string>) => AccessDeniedPage({ searchParams: Promise.resolve(query) });

describe("AccessDeniedPage", () => {
  it.each([
    ["forbidden", "This account can't open that."],
    ["no_grant", "That uses paid services, and needs a separate grant."],
    ["quota_exhausted", "You've used every run your grant allowed."],
    ["grant_expired", "Your grant for that has expired."],
    ["authorization_unavailable", "Access can't be checked right now."],
  ])("explains reason=%s", async (reason, message) => {
    render(await page({ reason, tool: "news-desk", action: "newsdesk:ask" }));
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("links to an email request naming the tool and action", async () => {
    render(await page({ reason: "no_grant", tool: "news-desk", action: "newsdesk:ask" }));
    expect(screen.getByRole("link", { name: /access@ashutosh-pandey\.com/ }).getAttribute("href")).toContain(
      "subject=Access%20request%3A%20News%20Desk%20newsdesk%3Aask",
    );
  });

  it("falls back to a general message for an unknown reason and ignores unknown tools", async () => {
    render(await page({ reason: "<script>", tool: "nope" }));
    expect(screen.getByText("This account can't open that.")).toBeInTheDocument();
  });
});
