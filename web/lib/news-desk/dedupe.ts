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
// swallowed by last week's copy.
export function withId(item: Omit<Headline, "id">): Headline {
  const key = `${normalizeTitle(item.title)}|${item.publishedAt.slice(0, 10)}`;
  const id = createHash("sha1").update(key).digest("hex").slice(0, 16);
  return { id, ...item };
}

// Google News sometimes stamps its own index time rather than the publisher's,
// so two copies of one story can land on different UTC days and get different
// ids. Same-title items this close together are one story; a daily release
// with a fixed title is about 24 hours apart and stays separate.
const SAME_STORY_MS = 12 * 60 * 60 * 1000;

export function mergeHeadlines(existing: Headline[], incoming: Headline[], now: Date): Headline[] {
  const cutoff = now.getTime() - MAX_AGE_MS;
  const byTitle = new Map<string, Headline[]>();
  // Existing first, so a stored item survives a later copy of the same story;
  // the one exception is a direct-feed copy replacing a Google News one.
  for (const headline of [...existing, ...incoming]) {
    const at = Date.parse(headline.publishedAt);
    if (at < cutoff) continue;
    const key = normalizeTitle(headline.title);
    const kept = byTitle.get(key) ?? [];
    const i = kept.findIndex(
      (k) => k.id === headline.id || Math.abs(Date.parse(k.publishedAt) - at) < SAME_STORY_MS,
    );
    if (i === -1) kept.push(headline);
    else if (!kept[i].direct && headline.direct) kept[i] = headline;
    byTitle.set(key, kept);
  }
  return [...byTitle.values()].flat().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
