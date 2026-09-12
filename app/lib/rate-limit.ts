// Fixed-window limiter held in module memory. Vercel runs each serverless instance
// separately, so a determined attacker spread across many cold starts gets more than
// LOGIN_MAX_ATTEMPTS total — this is a speed bump, not a distributed rate limiter.
// It is deliberately not backed by Redis or DynamoDB: a shared store is a recurring
// cost and an extra dependency, and for a single-user site the speed bump plus a
// strong APP_PASSWORD is the right trade. Revisit if the site ever gets real users.

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Ceiling on distinct keys tracked at once. Without it the map grows for the
// life of the instance, one entry per distinct caller, and nothing ever
// removes an entry whose window has long since lapsed.
export const MAX_TRACKED_WINDOWS = 10_000;

type Window = { count: number; startedAt: number };

const windows = new Map<string, Window>();

export function resetRateLimits(): void {
  windows.clear();
}

/** Test helper — how many keys are currently tracked. */
export function rateLimitWindowCount(): number {
  return windows.size;
}

/**
 * Identify the caller for rate-limiting purposes.
 *
 * Vercel overwrites `x-forwarded-for` and does not forward externally supplied
 * values, precisely to stop spoofing, so in production the header is already
 * trustworthy. This does not lean on that: `x-real-ip` is preferred, and the
 * `x-forwarded-for` fallback reads the LAST entry rather than the first. A
 * caller can prepend entries to that header but cannot remove the one a proxy
 * appends, so taking the first entry would let anyone mint a fresh bucket per
 * request and sidestep the limit entirely — which is exactly what happens
 * against a local dev server, where no proxy rewrites the header.
 */
export function clientKey(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;

  const parts =
    headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  // Falls back to a constant, not a unique value: a missing header should fail
  // closed into one shared bucket rather than hand every request its own
  // unlimited allowance.
  return parts[parts.length - 1] || "unknown";
}

function evictStale(now: number): void {
  for (const [key, window] of windows) {
    if (now - window.startedAt >= LOGIN_WINDOW_MS) windows.delete(key);
  }
  // If every window is still live, drop the oldest-inserted to stay bounded.
  // Sheddable by design: the worst case is one caller getting a fresh
  // allowance, which is the same position they would be in on a cold start.
  while (windows.size >= MAX_TRACKED_WINDOWS) {
    const oldest = windows.keys().next().value;
    if (oldest === undefined) break;
    windows.delete(oldest);
  }
}

export function checkRateLimit(
  key: string,
  now = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const existing = windows.get(key);

  if (!existing || now - existing.startedAt >= LOGIN_WINDOW_MS) {
    if (!existing) evictStale(now);
    windows.set(key, { count: 1, startedAt: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= LOGIN_MAX_ATTEMPTS) {
    const remainingMs = existing.startedAt + LOGIN_WINDOW_MS - now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
