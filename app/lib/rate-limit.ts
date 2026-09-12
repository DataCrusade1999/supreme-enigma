// Fixed-window limiter held in module memory. Vercel runs each serverless instance
// separately, so a determined attacker spread across many cold starts gets more than
// LOGIN_MAX_ATTEMPTS total — this is a speed bump, not a distributed rate limiter.
// It is deliberately not backed by Redis or DynamoDB: a shared store is a recurring
// cost and an extra dependency, and for a single-user site the speed bump plus a
// strong APP_PASSWORD is the right trade. Revisit if the site ever gets real users.

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

type Window = { count: number; startedAt: number };

const windows = new Map<string, Window>();

export function resetRateLimits(): void {
  windows.clear();
}

export function checkRateLimit(
  key: string,
  now = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const existing = windows.get(key);

  if (!existing || now - existing.startedAt >= LOGIN_WINDOW_MS) {
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
