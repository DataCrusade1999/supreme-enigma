import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  resetRateLimits,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
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
});
