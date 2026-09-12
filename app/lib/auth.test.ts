import { describe, expect, it } from "vitest";
import { checkPassword, createSessionCookieValue, verifySessionCookieValue } from "./auth";

describe("createSessionCookieValue / verifySessionCookieValue", () => {
  it("round-trips a valid cookie", () => {
    const secret = "test-secret";
    const value = createSessionCookieValue(secret);
    expect(verifySessionCookieValue(value, secret)).toBe(true);
  });

  it("rejects a tampered cookie", () => {
    const secret = "test-secret";
    const value = createSessionCookieValue(secret);
    expect(verifySessionCookieValue(value + "x", secret)).toBe(false);
  });

  it("rejects a cookie signed with a different secret", () => {
    const value = createSessionCookieValue("secret-a");
    expect(verifySessionCookieValue(value, "secret-b")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(verifySessionCookieValue(undefined, "test-secret")).toBe(false);
  });
});

describe("checkPassword", () => {
  it("accepts the correct password", () => {
    expect(checkPassword("hunter2", "hunter2")).toBe(true);
  });

  it("rejects a wrong password of the same length", () => {
    expect(checkPassword("hunter3", "hunter2")).toBe(false);
  });

  it("rejects a wrong password of a different length", () => {
    expect(checkPassword("short", "a-much-longer-password")).toBe(false);
  });

  it("rejects an empty submission", () => {
    expect(checkPassword("", "hunter2")).toBe(false);
  });

  it("compares buffers of equal length regardless of input length", () => {
    // timingSafeEqual throws RangeError on unequal-length buffers. If the
    // implementation hashes first, both buffers are always 32 bytes and it
    // never throws — which is the property we want.
    expect(() => checkPassword("x", "yyyyyyyyyyyyyyyyyyyy")).not.toThrow();
  });
});
