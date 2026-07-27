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

  it("rejects an incorrect password", () => {
    expect(checkPassword("wrong", "hunter2")).toBe(false);
  });

  it("rejects a different-length password without throwing", () => {
    expect(checkPassword("short", "a-much-longer-password")).toBe(false);
  });
});
