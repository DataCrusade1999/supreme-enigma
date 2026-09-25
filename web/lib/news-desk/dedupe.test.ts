// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_AGE_MS, mergeHeadlines, normalizeTitle, withId } from "./dedupe";
import type { Headline } from "./types";

const NOW = new Date("2026-09-25T12:00:00.000Z");

function item(over: Partial<Omit<Headline, "id">> = {}): Headline {
  return withId({
    title: "RBI keeps repo rate unchanged",
    url: "https://news.google.com/rss/articles/abc",
    source: "Reuters",
    publishedAt: "2026-09-25T09:00:00.000Z",
    direct: false,
    ...over,
  });
}

describe("normalizeTitle", () => {
  it("ignores case, punctuation and curly vs straight quotes", () => {
    expect(normalizeTitle("India’s GDP: Up 7%!")).toBe(normalizeTitle("india's gdp up 7%"));
  });

  it("collapses whitespace", () => {
    expect(normalizeTitle("  RBI   holds  ")).toBe("rbi holds");
  });
});

describe("withId", () => {
  it("gives the same id to titles that differ only in punctuation", () => {
    expect(item({ title: "India’s exports rise" }).id).toBe(item({ title: "India's exports rise." }).id);
  });

  it("gives different ids to different titles", () => {
    expect(item({ title: "A" }).id).not.toBe(item({ title: "B" }).id);
  });

  it("is 16 hex characters", () => {
    expect(item().id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("keeps a recurring release with the same title as a separate item each week", () => {
    // RBI publishes "Government Stock - Auction Results: Cut-off" every week.
    const title = "Government Stock - Auction Results: Cut-off";
    const lastWeek = item({ title, publishedAt: "2026-09-18T08:35:00.000Z" });
    const thisWeek = item({ title, publishedAt: "2026-09-25T08:35:00.000Z" });
    expect(lastWeek.id).not.toBe(thisWeek.id);
    expect(mergeHeadlines([lastWeek], [thisWeek], NOW)).toHaveLength(2);
  });
});

describe("mergeHeadlines", () => {
  it("keeps one item per story and prefers the publisher's own link", () => {
    const viaGoogle = item({ title: "Cabinet approves BIT template", source: "Mint" });
    const direct = item({
      title: "Cabinet approves BIT template",
      source: "Mint",
      url: "https://www.livemint.com/economy/bit",
      direct: true,
    });
    const merged = mergeHeadlines([], [viaGoogle, direct], NOW);
    expect(merged).toHaveLength(1);
    expect(merged[0].url).toBe("https://www.livemint.com/economy/bit");
  });

  it("keeps one item when the Google News copy lands on the next UTC day", () => {
    // Google News can stamp its index time rather than the publisher's, which
    // pushes a story published near IST midnight onto a different UTC date.
    const direct = item({
      title: "Cabinet approves BIT template",
      url: "https://www.livemint.com/economy/bit",
      publishedAt: "2026-09-25T18:35:00.000Z",
      direct: true,
    });
    const viaGoogle = item({ title: "Cabinet approves BIT template", publishedAt: "2026-09-26T02:00:00.000Z" });
    const merged = mergeHeadlines([viaGoogle], [direct], new Date("2026-09-26T12:00:00.000Z"));
    expect(merged).toHaveLength(1);
    expect(merged[0].url).toBe("https://www.livemint.com/economy/bit");
  });

  it("keeps a daily release with the same title as a separate item each day", () => {
    const title = "Money Market Operations";
    const merged = mergeHeadlines(
      [item({ title, publishedAt: "2026-09-24T12:30:00.000Z", direct: true })],
      [item({ title, publishedAt: "2026-09-25T12:00:00.000Z", direct: true })],
      new Date("2026-09-25T13:00:00.000Z"),
    );
    expect(merged).toHaveLength(2);
  });

  it("keeps an existing item over a new non-direct copy of it", () => {
    const stored = item({ url: "https://stored.example/1", direct: true });
    const again = item({ url: "https://news.google.com/other" });
    expect(mergeHeadlines([stored], [again], NOW)[0].url).toBe("https://stored.example/1");
  });

  it("drops anything older than 14 days, stored or new", () => {
    const old = new Date(NOW.getTime() - MAX_AGE_MS - 1000).toISOString();
    const merged = mergeHeadlines(
      [item({ title: "stored old", publishedAt: old })],
      [item({ title: "new old", publishedAt: old }), item({ title: "fresh" })],
      NOW,
    );
    expect(merged.map((h) => h.title)).toEqual(["fresh"]);
  });

  it("sorts newest first", () => {
    const merged = mergeHeadlines(
      [],
      [
        item({ title: "older", publishedAt: "2026-09-24T00:00:00.000Z" }),
        item({ title: "newer", publishedAt: "2026-09-25T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(merged.map((h) => h.title)).toEqual(["newer", "older"]);
  });
});
