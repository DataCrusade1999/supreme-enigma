import { getObjectText, putObjectConditional } from "./aws";

// One extraction per draft at a time (#110). The lock is an S3 object next to
// the draft, taken with a conditional write so two route instances racing for
// it cannot both win. The Vercel role can put objects under `resume/` but not
// delete them, so a lock is released by overwriting it, and a lock nobody
// released (a crashed or timed-out instance) is taken over once it is older
// than the route can run.

/** Longer than the extract route's 60 s maxDuration, so a live holder's lock
 * never looks abandoned. */
export const LOCK_TTL_MS = 90_000;

type LockBody = { claimedAt?: number; releasedAt?: number };

/** Takes the lock. Returns the token `releaseExtraction` needs, or null while
 * another caller holds it. */
export async function claimExtraction(
  bucket: string,
  key: string,
  now = Date.now(),
): Promise<string | null> {
  const body = JSON.stringify({ claimedAt: now });
  const created = await putObjectConditional(bucket, key, body);
  if (created !== null) return created;

  const current = await getObjectText(bucket, key);
  if (current === null) return putObjectConditional(bucket, key, body);

  let lock: LockBody = {};
  try {
    lock = JSON.parse(current.text) as LockBody;
  } catch {
    // An unreadable lock is treated as abandoned rather than held forever.
  }
  const held = lock.releasedAt === undefined && now - (lock.claimedAt ?? 0) < LOCK_TTL_MS;
  if (held) return null;
  // If-Match on the ETag just read: of two callers taking over the same
  // released lock, only the first write lands.
  return putObjectConditional(bucket, key, body, current.etag);
}

/** Releases a lock taken by `claimExtraction`. Never throws: a lock left behind
 * expires after LOCK_TTL_MS, and the route's answer should not depend on it. */
export async function releaseExtraction(bucket: string, key: string, token: string): Promise<void> {
  try {
    await putObjectConditional(bucket, key, JSON.stringify({ releasedAt: Date.now() }), token);
  } catch {
    // See above.
  }
}
