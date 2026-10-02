import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeUrl, exchangeCode, pkcePair, refreshIdToken, safeNext, verifyIdToken } from "./cognito";

beforeEach(() => {
  process.env.COGNITO_DOMAIN = "https://login.example.com";
  process.env.COGNITO_CLIENT_ID = "client123";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_pool";
});

describe("safeNext", () => {
  it.each([
    ["/tools/news-desk", "/tools/news-desk"],
    ["/keystatic?path=posts#x", "/keystatic?path=posts#x"],
    [null, "/tools"],
    ["", "/tools"],
    ["//evil.example", "/tools"],
    ["/\\evil.example", "/tools"],
    // The URL parser strips the tab, leaving "//evil.example".
    ["/\t/evil.example", "/tools"],
    ["/\n/evil.example", "/tools"],
    ["https://evil.example", "/tools"],
    ["tools", "/tools"],
  ])("%j -> %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe("pkcePair", () => {
  it("derives the S256 challenge from the verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
});

describe("authorizeUrl", () => {
  it("asks for an authorization code with PKCE", () => {
    const url = new URL(authorizeUrl({ redirectUri: "https://site/api/auth/callback", state: "st", challenge: "ch" }));
    expect(url.origin + url.pathname).toBe("https://login.example.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client123",
      redirect_uri: "https://site/api/auth/callback",
      scope: "openid email",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
  });
});

describe("exchangeCode", () => {
  it("posts the code and verifier and returns the ID token", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id_token: "idtok", refresh_token: "rt" }) }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeCode({ code: "c", verifier: "v", redirectUri: "https://site/api/auth/callback" })).toEqual({ idToken: "idtok", refreshToken: "rt" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://login.example.com/oauth2/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      grant_type: "authorization_code",
      client_id: "client123",
      code: "c",
      redirect_uri: "https://site/api/auth/callback",
      code_verifier: "v",
    });
  });

  it("throws when Cognito refuses the code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) })));
    await expect(exchangeCode({ code: "c", verifier: "v", redirectUri: "r" })).rejects.toThrow("400");
  });
});

describe("exchangeCode", () => {
  it("throws when Cognito returns no refresh token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id_token: "idtok" }) })));
    await expect(exchangeCode({ code: "c", verifier: "v", redirectUri: "r" })).rejects.toThrow("no tokens");
  });
});

describe("refreshIdToken", () => {
  it("posts the refresh token and returns the new ID token", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id_token: "new" }) }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshIdToken("rt")).toBe("new");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://login.example.com/oauth2/token");
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      grant_type: "refresh_token",
      client_id: "client123",
      refresh_token: "rt",
    });
  });

  it("throws when Cognito refuses the refresh token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })));
    await expect(refreshIdToken("rt")).rejects.toThrow("400");
  });
});

describe("verifyIdToken", () => {
  it("is true when the verifier accepts the token", async () => {
    expect(await verifyIdToken("t", { verify: vi.fn(async () => ({ sub: "u" })) })).toBe(true);
  });

  it("is false when it throws", async () => {
    expect(await verifyIdToken("t", { verify: vi.fn(async () => { throw new Error("bad sig"); }) })).toBe(false);
  });
});
