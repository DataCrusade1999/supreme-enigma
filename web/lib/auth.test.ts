import { describe, expect, it } from "vitest";
import {
  createSessionCookieValue,
  verifySessionCookieValue,
  SESSION_MAX_AGE_MS,
} from "./auth";

describe("session cookie", () => {
  const SECRET = "test-secret";
  const T0 = 1_700_000_000_000;

  it("accepts a freshly issued cookie", () => {
    const value = createSessionCookieValue(SECRET, T0);
    expect(verifySessionCookieValue(value, SECRET, T0)).toBe(true);
  });

  it("accepts a cookie just inside the max age", () => {
    const value = createSessionCookieValue(SECRET, T0);
    expect(
      verifySessionCookieValue(value, SECRET, T0 + SESSION_MAX_AGE_MS - 1),
    ).toBe(true);
  });

  it("rejects a cookie past the max age", () => {
    const value = createSessionCookieValue(SECRET, T0);
    expect(
      verifySessionCookieValue(value, SECRET, T0 + SESSION_MAX_AGE_MS + 1),
    ).toBe(false);
  });

  it("rejects a cookie signed with a different secret", () => {
    const value = createSessionCookieValue("other-secret", T0);
    expect(verifySessionCookieValue(value, SECRET, T0)).toBe(false);
  });

  it("rejects a cookie whose timestamp was tampered with", () => {
    const value = createSessionCookieValue(SECRET, T0);
    const [, sig] = value.split(".");
    const forged = `${T0 + 1}.${sig}`;
    expect(verifySessionCookieValue(forged, SECRET, T0)).toBe(false);
  });

  it("rejects undefined, empty, and malformed values", () => {
    expect(verifySessionCookieValue(undefined, SECRET, T0)).toBe(false);
    expect(verifySessionCookieValue("", SECRET, T0)).toBe(false);
    expect(verifySessionCookieValue("no-separator", SECRET, T0)).toBe(false);
    expect(verifySessionCookieValue("notanumber.abc", SECRET, T0)).toBe(false);
  });

  it("issues a different value at a different time", () => {
    expect(createSessionCookieValue(SECRET, T0)).not.toBe(
      createSessionCookieValue(SECRET, T0 + 1000),
    );
  });
});
