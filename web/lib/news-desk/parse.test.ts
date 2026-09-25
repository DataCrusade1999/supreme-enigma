// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFeed, parsePubDate } from "./parse";
import type { SourceDef } from "./types";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");

const direct = (name: string, summary = false): SourceDef => ({
  name,
  url: "https://example.test/feed",
  kind: "direct",
  summary,
});
const google: SourceDef = {
  name: "Google News: Reuters",
  url: "https://news.google.com/rss/search?q=x",
  kind: "google",
  summary: false,
};

describe("parsePubDate", () => {
  it("parses an RFC 822 date with GMT", () => {
    expect(parsePubDate("Wed, 23 Sep 2026 11:15:00 GMT")).toBe("2026-09-23T11:15:00.000Z");
  });

  it("parses a numeric offset", () => {
    expect(parsePubDate("Fri, 25 Sep 2026 12:45:21 +0530")).toBe("2026-09-25T07:15:21.000Z");
  });

  it("treats a date with no zone as IST, not as the server's local time", () => {
    // RBI omits the zone. Vercel runs in UTC, so a bare parse would be 5.5 hours late.
    expect(parsePubDate("Fri, 25 Sep 2026 14:05:00")).toBe("2026-09-25T08:35:00.000Z");
  });

  it("parses SEBI's '24 Sep, 2026 +0530'", () => {
    expect(parsePubDate("24 Sep, 2026 +0530")).toBe("2026-09-23T18:30:00.000Z");
  });

  it("returns null for missing or unparseable input", () => {
    expect(parsePubDate(undefined)).toBeNull();
    expect(parsePubDate("")).toBeNull();
    expect(parsePubDate("sometime last week")).toBeNull();
  });
});

describe("parseFeed", () => {
  it("reads a direct feed with CDATA and keeps its summary when asked", () => {
    const [item] = parseFeed(fixture("ft.xml"), direct("FT", true));
    expect(item).toEqual({
      title: "Indian stock market will double in five years, says Motilal Oswal’s Raamdeo Agrawal",
      url: "https://www.ft.com/content/dbe10037-caf0-475c-b05e-692df41c31eb?syn-25a6b1a6=1",
      source: "FT",
      summary:
        "Foreign investors have oversold the correction, the billionaire investor says in our latest India Business Briefing Q&A",
      publishedAt: "2026-09-25T01:30:06.000Z",
      direct: true,
    });
  });

  it("strips HTML from a summary and cuts it to about 200 characters", () => {
    const [item] = parseFeed(fixture("mint.xml"), direct("Mint", true));
    expect(item.summary).not.toContain("<b>");
    expect(item.summary).toContain("substantially shorten");
    expect(item.summary!.length).toBeLessThanOrEqual(201);
    expect(item.summary!.endsWith("…")).toBe(true);
    expect(item.url).toBe(
      "https://www.livemint.com/economy/cabinet-bilateral-investment-treaty-template-dispute-settlements-11790315746392.html",
    );
  });

  it("drops the summary for sources not flagged for it", () => {
    const [item] = parseFeed(fixture("rbi.xml"), direct("RBI press releases"));
    expect(item.summary).toBeUndefined();
    expect(item.publishedAt).toBe("2026-09-25T08:35:00.000Z");
  });

  it("drops items with no parseable date", () => {
    const items = parseFeed(fixture("sebi.xml"), direct("SEBI"));
    expect(items.map((i) => i.title)).toEqual([
      "Order in the matter of Non-Compliance of Minimum Public Shareholding in Omaxe Limited",
    ]);
  });

  it("takes a Google News item's source from <source> and strips it from the title", () => {
    const [first, second] = parseFeed(fixture("google-news.xml"), google);
    expect(first).toMatchObject({
      title: "India to continue prudent fiscal management, chief economic advisor says",
      source: "Reuters",
      direct: false,
      url: "https://news.google.com/rss/articles/CBMitwFBVV95cUxN?oc=5",
    });
    expect(first.summary).toBeUndefined();
    // A " - " inside the headline is not mistaken for the publisher, and
    // entities are decoded once.
    expect(second.title).toBe("Tata & Sons – a profile - Mumbai edition");
    expect(second.source).toBe("Business Standard");
  });

  it("falls back to the title suffix when a Google News item has no <source>", () => {
    const third = parseFeed(fixture("google-news.xml"), google)[2];
    expect(third.title).toBe("Budget talk begins");
    expect(third.source).toBe("Mint");
  });

  it("rejects something that is not RSS, such as a 200 HTML error page", () => {
    expect(() => parseFeed("<html><body>Access denied</body></html>", direct("X"))).toThrow(
      "not an RSS feed",
    );
  });

  it("drops items whose link is not http or https", () => {
    const xml = `<rss><channel>
      <item><title>Bad</title><link>javascript:alert(1)</link><pubDate>Fri, 25 Sep 2026 01:30:06 GMT</pubDate></item>
      <item><title>Good</title><link>https://ok.example/a</link><pubDate>Fri, 25 Sep 2026 01:30:06 GMT</pubDate></item>
    </channel></rss>`;
    expect(parseFeed(xml, direct("X")).map((i) => i.title)).toEqual(["Good"]);
  });

  it("returns an empty list for a channel with no items", () => {
    expect(parseFeed('<rss><channel><title>t</title></channel></rss>', direct("X"))).toEqual([]);
  });
});
