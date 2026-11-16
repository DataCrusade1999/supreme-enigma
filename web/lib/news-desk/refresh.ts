import { mergeHeadlines } from "./dedupe";
import { fetchAllFeeds } from "./feeds";
import { DEFAULT_INDICATORS } from "./defaults";
import { refreshIndicators } from "./indicators";
import { readIndicatorDefs, readSnapshot, SnapshotCorruptError, writeSnapshot } from "./store";
import { tagHeadlines } from "./tagger";
import type { Headline, IndicatorDef, Snapshot, SourceError } from "./types";

/** Refreshes an item may go untagged before it stops being sent (#263). An item
 * the model keeps omitting would otherwise be paid for on every refresh until it
 * ages out after 14 days. One that hits the cap shows only under All. */
export const MAX_TAG_ATTEMPTS = 3;

// Retries of a failed snapshot write, after these waits. The tags in it are
// already paid for, and a lost write pays for them again on the next refresh.
const WRITE_RETRY_MS = [250, 1000];

export async function runRefresh(now: Date = new Date()): Promise<Snapshot> {
  // Read before fetching: if S3 is unreachable there is no point spending the
  // feed round-trips, and nothing must be written over a snapshot we could not read.
  const [previous, defsRead] = await Promise.all([readPrevious(), readDefs()]);

  // Indicators do not depend on the headlines, so they run alongside the
  // feed-and-tag chain; one after the other would not fit the route's 60 s.
  const [{ headlines, sourceErrors }, refreshed] = await Promise.all([
    refreshHeadlines(previous?.headlines ?? [], now),
    refreshIndicators(defsRead.defs, previous?.indicators ?? [], now),
  ]);

  // On a fallback the defaults were refreshed, but the file may hold pins the
  // defaults lack. Keep those rows as they were, marked stale, rather than drop them.
  const defIds = new Set(defsRead.defs.map((d) => d.id));
  const kept = defsRead.error
    ? (previous?.indicators ?? [])
        .filter((v) => !defIds.has(v.id))
        .map((v) => ({ ...v, error: `indicators.json ${defsRead.error!.message}` }))
    : [];
  const indicators = [...refreshed, ...kept];

  const snapshot: Snapshot = {
    version: 1,
    refreshedAt: now.toISOString(),
    headlines,
    indicators,
    sourceErrors: defsRead.error ? [...sourceErrors, defsRead.error] : sourceErrors,
  };
  await writeWithRetry(snapshot);
  return snapshot;
}

async function writeWithRetry(snapshot: Snapshot): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await writeSnapshot(snapshot);
    } catch (err) {
      if (attempt >= WRITE_RETRY_MS.length) throw err;
      console.error("news-desk: snapshot write failed, retrying", err);
      await new Promise((resolve) => setTimeout(resolve, WRITE_RETRY_MS[attempt]));
    }
  }
}

async function readPrevious(): Promise<Snapshot | null> {
  try {
    return await readSnapshot();
  } catch (err) {
    // A corrupt file would otherwise fail every refresh until someone deleted it
    // by hand. Replacing it loses at most 14 days of headlines the feeds still carry.
    if (!(err instanceof SnapshotCorruptError)) throw err;
    console.error("news-desk: replacing a corrupt snapshot", err);
    return null;
  }
}

/** The indicator definitions, or the defaults for this refresh when the file
 * cannot be read, so an S3 error or a malformed file does not cost the headlines.
 * The file is left alone and the failure is listed with the source errors; Phase
 * 4's pin writer must refuse to write over a file it could not read. */
async function readDefs(): Promise<{ defs: IndicatorDef[]; error?: SourceError }> {
  try {
    return { defs: await readIndicatorDefs() };
  } catch (err) {
    console.error("news-desk: indicators.json unreadable, using the defaults", err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      defs: DEFAULT_INDICATORS,
      error: { source: "indicators.json", message: `unreadable, used the defaults: ${message.slice(0, 200)}` },
    };
  }
}

async function refreshHeadlines(
  existing: Headline[],
  now: Date,
): Promise<{ headlines: Headline[]; sourceErrors: SourceError[] }> {
  const { headlines, errors } = await fetchAllFeeds();
  // Merge first so a story carried by two sources is tagged once. Everything still
  // Untagged is sent, new items and items whose chunk failed last time, up to
  // MAX_TAG_ATTEMPTS refreshes each.
  const merged = mergeHeadlines(existing, headlines, now);
  const sent = merged.filter((h) => h.tag === "Untagged" && (h.tagAttempts ?? 0) < MAX_TAG_ATTEMPTS);
  const tagging = await tagHeadlines(sent);
  const sentIds = new Set(sent.map((h) => h.id));
  if (tagging.calls > 0) {
    console.log(
      `news-desk: tagged ${tagging.tags.size} headlines in ${tagging.calls} calls ` +
        `(${tagging.failedCalls} failed), $${tagging.costUsd.toFixed(4)}`,
    );
  }
  return {
    headlines: merged.map((h) => {
      const tag = tagging.tags.get(h.id);
      if (tag) return { ...h, tag };
      // Counted only when a call was made: with tagging unconfigured nothing
      // was sent, and nothing was paid for.
      if (tagging.calls > 0 && sentIds.has(h.id)) return { ...h, tagAttempts: (h.tagAttempts ?? 0) + 1 };
      return h;
    }),
    sourceErrors: errors,
  };
}
