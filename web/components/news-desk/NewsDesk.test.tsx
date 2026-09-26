import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewsDesk } from "./NewsDesk";
import type { Snapshot } from "../../lib/news-desk/types";

const NOW = "2026-09-25T12:00:00.000Z";

const SNAPSHOT: Snapshot = {
  version: 1,
  refreshedAt: "2026-09-25T10:00:00.000Z",
  headlines: [
    {
      id: "a",
      title: "Moody's raises India FY27 GDP forecast to 7%",
      url: "https://news.google.com/rss/articles/a",
      source: "Reuters",
      publishedAt: "2026-09-25T09:00:00.000Z",
      direct: false,
      tag: "Economy",
    },
    {
      id: "b",
      title: "Cabinet to decide on new BIT template",
      url: "https://www.livemint.com/economy/bit",
      source: "Mint",
      summary: "New template aims to ease dispute settlement.",
      publishedAt: "2026-09-25T08:00:00.000Z",
      direct: true,
      tag: "Legislation",
    },
  ],
  sourceErrors: [{ source: "SEBI", message: "timed out" }],
};

describe("NewsDesk", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists headlines newest first, linking out in a new tab", () => {
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Moody's raises India FY27 GDP forecast to 7%",
      "Cabinet to decide on new BIT template",
    ]);
    expect(links[1]).toHaveAttribute("href", "https://www.livemint.com/economy/bit");
    expect(links[1]).toHaveAttribute("target", "_blank");
    expect(links[1]).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("New template aims to ease dispute settlement.")).toBeInTheDocument();
    expect(screen.getByText("Reuters · 3h ago")).toBeInTheDocument();
  });

  it("says when it last refreshed and which sources failed", () => {
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    expect(screen.getByText(/Refreshed 2h ago/)).toBeInTheDocument();
    expect(screen.getByText("1 source failed")).toBeInTheDocument();
    expect(screen.getByText("SEBI: timed out")).toBeInTheDocument();
  });

  it("shows an empty state before the first refresh", () => {
    render(<NewsDesk initial={null} problem={null} nowIso={NOW} />);
    expect(screen.getByText("Nothing saved yet. Press Refresh to fetch headlines.")).toBeInTheDocument();
  });

  it("shows the server's problem instead of a list", () => {
    render(<NewsDesk initial={null} problem="Could not read the saved headlines." nowIso={NOW} />);
    expect(screen.getByText("Could not read the saved headlines.")).toBeInTheDocument();
  });

  it("replaces the list with the refreshed snapshot, disabling the button meanwhile", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    render(<NewsDesk initial={null} problem={null} nowIso={NOW} />);

    const button = screen.getByRole("button", { name: "Refresh" });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    expect(fetch).toHaveBeenCalledWith("/api/news-desk/refresh", { method: "POST" });

    resolve(new Response(JSON.stringify(SNAPSHOT), { status: 200 }));
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("keeps the current list and says why when a refresh fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "storage not configured" }), { status: 503 })),
    );
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed: storage not configured"),
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});
