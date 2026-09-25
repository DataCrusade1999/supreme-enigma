import { XMLParser } from "fast-xml-parser";
import type { Headline, SourceDef } from "./types";

const SUMMARY_MAX = 200;

const parser = new XMLParser({
  ignoreAttributes: true,
  // Keep every value a string. The default turns a title like "2026" into a number.
  parseTagValue: false,
  isArray: (name) => name === "item",
});

// A zone at the end: GMT, UTC, Z, or a numeric offset like +0530 / +05:30.
const HAS_ZONE = /(GMT|UTC|Z|[+-]\d{2}:?\d{2})\s*$/i;

/** ISO 8601 UTC, or null. Feeds without a zone publish in IST (RBI does), and
 * SEBI writes "24 Sep, 2026 +0530", which Date.parse rejects because of the comma. */
export function parsePubDate(raw: string | undefined): string | null {
  if (!raw) return null;
  let text = raw.trim().replace(/^(\d{1,2} [A-Za-z]{3}),/, "$1");
  // V8's fallback parser accepts almost anything ("sometime last week +0530" is
  // the year 529), so demand a four-digit year before trusting it.
  if (!/\b(19|20)\d{2}\b/.test(text)) return null;
  if (!HAS_ZONE.test(text)) text += " +0530";
  // V8 rejects a date with a zone but no time ("24 Sep 2026 +0530").
  if (!text.includes(":")) text = text.replace(/\s+([+-]\d{4})$/, " 00:00:00 $1");
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Descriptions arrive as HTML inside CDATA, so the XML parser leaves their
// entities alone. Titles are already decoded by the parser and must not pass
// through here, or "&amp;amp;" would decode twice.
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function toSummary(html: string): string | undefined {
  const text = decodeHtmlEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (text.length <= SUMMARY_MAX) return text;
  return text.slice(0, SUMMARY_MAX).replace(/\s+\S*$/, "") + "…";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseFeed(xml: string, source: SourceDef): Omit<Headline, "id">[] {
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel;
  if (!channel) throw new Error("not an RSS feed");
  const items: unknown[] = channel.item ?? [];

  const out: Omit<Headline, "id">[] = [];
  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    let title = text(item.title);
    const url = text(item.link);
    const publishedAt = parsePubDate(text(item.pubDate));
    // The link becomes an <a href> on a page behind the password, so a
    // javascript: or data: link from a bad feed would run with the session.
    if (!title || !/^https?:\/\//i.test(url) || !publishedAt) continue;

    let name = source.name;
    if (source.kind === "google") {
      // Google News names the publisher in <source> and repeats it as a
      // " - Publisher" title suffix. Trust <source>; guess from the last " - "
      // only when it is missing, since headlines contain " - " themselves.
      const publisher = text(item.source);
      if (publisher) {
        name = publisher;
        const suffix = ` - ${publisher}`;
        if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
      } else {
        const cut = title.lastIndexOf(" - ");
        if (cut > 0) {
          name = title.slice(cut + 3).trim();
          title = title.slice(0, cut).trim();
        }
      }
    }

    const summary = source.summary ? toSummary(text(item.description)) : undefined;
    out.push({
      title,
      url,
      source: name,
      ...(summary ? { summary } : {}),
      publishedAt,
      direct: source.kind === "direct",
    });
  }
  return out;
}
