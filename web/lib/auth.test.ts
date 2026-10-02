import { describe, expect, it } from "vitest";
import {
  clearSessionCookies,
  decodeClaims,
  ID_COOKIE,
  readSession,
  REFRESH_COOKIE,
  seal,
  sessionFromTokens,
  setSessionCookies,
  unseal,
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

const jwt = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

function jar(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { value: values[name] } : undefined) };
}

function recorder() {
  const set: Record<string, { value: string; options: Record<string, unknown> }> = {};
  return {
    set,
    response: { cookies: { set: (name: string, value: string, options: object) => { set[name] = { value, options: options as Record<string, unknown> }; } } },
  };
}

describe("seal / unseal", () => {
  it("round-trips", () => {
    expect(unseal(seal("hello", "s1"), "s1")).toBe("hello");
  });

  it("produces a different ciphertext each time", () => {
    expect(seal("hello", "s1")).not.toBe(seal("hello", "s1"));
  });

  it.each([
    ["wrong secret", (v: string) => ({ value: v, secret: "s2" })],
    ["one changed character", (v: string) => ({ value: (v[5] === "A" ? "B" : "A") + v.slice(1), secret: "s1" })],
    ["truncated", (v: string) => ({ value: v.slice(0, 20), secret: "s1" })],
    ["not base64", () => ({ value: "!!!", secret: "s1" })],
    ["empty", () => ({ value: "", secret: "s1" })],
  ])("rejects %s", (_label, mutate) => {
    const { value, secret } = mutate(seal("hello", "s1"));
    expect(unseal(value, secret)).toBeNull();
  });

  it("returns null for a missing cookie", () => {
    expect(unseal(undefined, "s1")).toBeNull();
  });
});

describe("decodeClaims", () => {
  it("reads the payload", () => {
    expect(decodeClaims(jwt({ sub: "u1" }))).toEqual({ sub: "u1" });
  });

  it.each(["", "abc", "a.!!!.c", `a.${Buffer.from("[1]").toString("base64url")}.c`])("returns null for %j", (value) => {
    expect(decodeClaims(value)).toBeNull();
  });
});

describe("sessionFromTokens", () => {
  it("reads sub, email, groups and exp", () => {
    const token = jwt({ sub: "u1", email: "a@example.com", exp: 100, "cognito:groups": ["friends", "us-east-1_x_Google"] });
    expect(sessionFromTokens(token, "rt")).toEqual({
      idToken: token,
      refreshToken: "rt",
      sub: "u1",
      email: "a@example.com",
      groups: ["friends", "us-east-1_x_Google"],
      expiresAt: 100,
    });
  });

  // A first-time Google user is in no group yet: the claim is absent, not empty.
  it("treats a missing cognito:groups claim as no groups", () => {
    expect(sessionFromTokens(jwt({ sub: "u1", exp: 100 }), null)?.groups).toEqual([]);
  });

  it("drops non-string group entries", () => {
    expect(sessionFromTokens(jwt({ sub: "u1", exp: 100, "cognito:groups": ["owner", 7] }), null)?.groups).toEqual(["owner"]);
  });

  it.each([{ exp: 100 }, { sub: "u1" }, { sub: 5, exp: 100 }])("returns null without a string sub and a numeric exp: %j", (claims) => {
    expect(sessionFromTokens(jwt(claims), null)).toBeNull();
  });
});

describe("readSession", () => {
  const token = jwt({ sub: "u1", exp: 100 });

  it("opens both cookies", () => {
    const session = readSession(jar({ [ID_COOKIE]: seal(token, "s1"), [REFRESH_COOKIE]: seal("rt", "s1") }), "s1");
    expect(session).toMatchObject({ idToken: token, refreshToken: "rt", sub: "u1" });
  });

  it("works without a refresh cookie", () => {
    expect(readSession(jar({ [ID_COOKIE]: seal(token, "s1") }), "s1")?.refreshToken).toBeNull();
  });

  it("returns null without an ID cookie, or with one sealed under another secret", () => {
    expect(readSession(jar({}), "s1")).toBeNull();
    expect(readSession(jar({ [ID_COOKIE]: seal(token, "other") }), "s1")).toBeNull();
  });
});

describe("setSessionCookies / clearSessionCookies", () => {
  it("sets both cookies sealed, httpOnly, secure, lax, path /, 7 days", () => {
    const { set, response } = recorder();
    setSessionCookies(response, { idToken: "id", refreshToken: "rt" }, "s1");
    expect(unseal(set[ID_COOKIE].value, "s1")).toBe("id");
    expect(unseal(set[REFRESH_COOKIE].value, "s1")).toBe("rt");
    for (const name of [ID_COOKIE, REFRESH_COOKIE]) {
      expect(set[name].options).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 604800 });
    }
  });

  it("leaves the refresh cookie alone when only the ID token changes", () => {
    const { set, response } = recorder();
    setSessionCookies(response, { idToken: "id" }, "s1");
    expect(Object.keys(set)).toEqual([ID_COOKIE]);
  });

  it("clears both", () => {
    const { set, response } = recorder();
    clearSessionCookies(response);
    expect(set[ID_COOKIE]).toMatchObject({ value: "", options: { maxAge: 0, path: "/" } });
    expect(set[REFRESH_COOKIE]).toMatchObject({ value: "", options: { maxAge: 0, path: "/" } });
  });
});
