import { mergeHeadlines } from "./dedupe";
import { fetchAllFeeds } from "./feeds";
import { readSnapshot, SnapshotCorruptError, writeSnapshot } from "./store";
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
  const snapshot: Snapshot = {
    version: 1,
    refreshedAt: now.toISOString(),
    headlines: mergeHeadlines(existing, headlines, now),
    sourceErrors: errors,
  };
  await writeSnapshot(snapshot);
  return snapshot;
}
