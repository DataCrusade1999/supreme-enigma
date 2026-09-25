import { createHash } from "node:crypto";
import type { Headline } from "./types";

export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** The dedupe key. Google News links are news.google.com redirects, so the same
 * story never shares a URL with the publisher's own feed; the title is all that
 * matches. See the design spec §5.2. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛'`]/g, "")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim();
}

// The publish day is part of the key so a recurring release with a fixed title
// (RBI's weekly auction results) is a new item each week instead of being
// swallowed by last week's copy. The same story from Google News and from the
// publisher carries the same timestamp, so cross-source dedupe still works.
export function withId(item: Omit<Headline, "id">): Headline {
  const key = `${normalizeTitle(item.title)}|${item.publishedAt.slice(0, 10)}`;
  const id = createHash("sha1").update(key).digest("hex").slice(0, 16);
  return { id, ...item };
}

export function mergeHeadlines(existing: Headline[], incoming: Headline[], now: Date): Headline[] {
  const cutoff = now.getTime() - MAX_AGE_MS;
  const byId = new Map<string, Headline>();
  // Existing first, so a stored item survives a later copy of the same story;
  // the one exception is a direct-feed copy replacing a Google News one.
  for (const headline of [...existing, ...incoming]) {
    if (Date.parse(headline.publishedAt) < cutoff) continue;
    const kept = byId.get(headline.id);
    if (!kept || (!kept.direct && headline.direct)) byId.set(headline.id, headline);
  }
  return [...byId.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
