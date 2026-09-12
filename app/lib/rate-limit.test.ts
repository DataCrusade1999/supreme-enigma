import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  clearRateLimit,
  clientKey,
  resetRateLimits,
  rateLimitWindowCount,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  MAX_TRACKED_WINDOWS,
} from "./rate-limit";

describe("checkRateLimit", () => {
  const T0 = 1_700_000_000_000;

  beforeEach(() => {
    resetRateLimits();
  });

  it("allows attempts up to the limit", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      expect(checkRateLimit("1.2.3.4", T0).allowed).toBe(true);
    }
  });

  it("blocks the attempt after the limit", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      checkRateLimit("1.2.3.4", T0);
    }
    const result = checkRateLimit("1.2.3.4", T0);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      checkRateLimit("1.2.3.4", T0);
    }
    expect(checkRateLimit("1.2.3.4", T0).allowed).toBe(false);
    expect(checkRateLimit("5.6.7.8", T0).allowed).toBe(true);
  });

  it("allows again once the window has passed", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      checkRateLimit("1.2.3.4", T0);
    }
    expect(checkRateLimit("1.2.3.4", T0).allowed).toBe(false);
    expect(checkRateLimit("1.2.3.4", T0 + LOGIN_WINDOW_MS + 1).allowed).toBe(true);
  });

  it("reports a shrinking retry-after as the window elapses", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      checkRateLimit("1.2.3.4", T0);
    }
    const early = checkRateLimit("1.2.3.4", T0).retryAfterSeconds;
    const later = checkRateLimit("1.2.3.4", T0 + LOGIN_WINDOW_MS / 2).retryAfterSeconds;
    expect(later).toBeLessThan(early);
  });

  it("frees the caller's budget once clearRateLimit is called", () => {
    // A successful login clears the window, so someone who genuinely signs in
    // repeatedly (several devices behind one NAT, repeated cookie expiries) is
    // never locked out by their own successful logins.
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      expect(checkRateLimit("1.2.3.4", T0).allowed).toBe(true);
    }
    expect(checkRateLimit("1.2.3.4", T0).allowed).toBe(false);

    clearRateLimit("1.2.3.4");
    expect(checkRateLimit("1.2.3.4", T0).allowed).toBe(true);
  });

  it("clearing one caller's budget leaves others untouched", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      checkRateLimit("5.6.7.8", T0);
    }
    clearRateLimit("1.2.3.4");
    expect(checkRateLimit("5.6.7.8", T0).allowed).toBe(false);
  });

  it("does not grow its tracking map without bound", () => {
    for (let i = 0; i < MAX_TRACKED_WINDOWS + 500; i++) {
      checkRateLimit(`key-${i}`, T0);
    }
    expect(rateLimitWindowCount()).toBeLessThanOrEqual(MAX_TRACKED_WINDOWS);
  });

  it("drops windows that have already expired rather than keeping them forever", () => {
    checkRateLimit("old-key", T0);
    // A later request for a different key sweeps windows that can no longer
    // block anything, so an idle instance does not accumulate dead entries.
    checkRateLimit("new-key", T0 + LOGIN_WINDOW_MS + 1);
    expect(rateLimitWindowCount()).toBe(1);
  });
});

describe("clientKey", () => {
  // Vercel overwrites x-forwarded-for and does not forward externally supplied
  // values (https://vercel.com/docs/headers/request-headers), so in production
  // the header is trustworthy. These tests pin the behaviour anyway: the code
  // must not depend on that guarantee holding, and locally it does not hold.
  const h = (init: Record<string, string>) => new Headers(init);

  it("prefers x-real-ip, which the platform sets", () => {
    expect(clientKey(h({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("ignores a client-supplied x-forwarded-for when x-real-ip is present", () => {
    expect(
      clientKey(h({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1" })),
    ).toBe("203.0.113.7");
  });

  it("takes the LAST x-forwarded-for entry, not the first", () => {
    // A caller can prepend entries but cannot remove the one the proxy appends,
    // so the last entry is the closest thing to a trustworthy value.
    expect(clientKey(h({ "x-forwarded-for": "10.0.0.1, 10.0.0.2, 203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("gives a spoofing caller the same bucket every time", () => {
    const a = clientKey(h({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" }));
    const b = clientKey(h({ "x-forwarded-for": "10.0.0.99, 203.0.113.7" }));
    expect(a).toBe(b);
  });

  it("falls back to one shared bucket when no header identifies the caller", () => {
    // Deliberately not a per-request unique value: failing closed into one
    // shared bucket keeps the limiter biting, where a unique key would
    // silently disable it.
    expect(clientKey(h({}))).toBe("unknown");
    expect(clientKey(h({ "x-forwarded-for": "   " }))).toBe("unknown");
  });
});
