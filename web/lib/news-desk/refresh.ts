import { mergeHeadlines } from "./dedupe";
import { fetchAllFeeds } from "./feeds";
import { readSnapshot, SnapshotCorruptError, writeSnapshot } from "./store";
import { tagHeadlines } from "./tagger";
import type { Headline, Snapshot } from "./types";

export async function runRefresh(now: Date = new Date()): Promise<Snapshot> {
  // Read before fetching: if S3 is unreachable there is no point spending the
  // feed round-trips, and nothing must be written over a snapshot we could not read.
  let existing: Headline[] = [];
  try {
    existing = (await readSnapshot())?.headlines ?? [];
  } catch (err) {
    // A corrupt file would otherwise fail every refresh until someone deleted it
    // by hand. Replacing it loses at most 14 days of headlines the feeds still carry.
    if (!(err instanceof SnapshotCorruptError)) throw err;
    console.error("news-desk: replacing a corrupt snapshot", err);
  }

  const { headlines, errors } = await fetchAllFeeds();
  // Merge first so a story carried by two sources is tagged once. Everything still
  // Untagged is sent: new items, and items whose chunk failed last time.
  const merged = mergeHeadlines(existing, headlines, now);
  const tagging = await tagHeadlines(merged.filter((h) => h.tag === "Untagged"));
  if (tagging.calls > 0) {
    console.log(
      `news-desk: tagged ${tagging.tags.size} headlines in ${tagging.calls} calls ` +
        `(${tagging.failedCalls} failed), $${tagging.costUsd.toFixed(4)}`,
    );
  }

  const snapshot: Snapshot = {
    version: 1,
    refreshedAt: now.toISOString(),
    headlines: merged.map((h) => {
      const tag = tagging.tags.get(h.id);
      return tag ? { ...h, tag } : h;
    }),
    sourceErrors: errors,
  };
  await writeSnapshot(snapshot);
  return snapshot;
}
