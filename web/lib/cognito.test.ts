import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeUrl, exchangeCode, isOwner, pkcePair, safeNext } from "./cognito";

beforeEach(() => {
  process.env.COGNITO_DOMAIN = "https://login.example.com";
  process.env.COGNITO_CLIENT_ID = "client123";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_pool";
  process.env.OWNER_EMAIL = "owner@example.com";
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
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id_token: "idtok" }) }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeCode({ code: "c", verifier: "v", redirectUri: "https://site/api/auth/callback" })).toBe("idtok");
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

describe("isOwner", () => {
  const verifierFor = (payload: Record<string, unknown>) => ({ verify: vi.fn(async () => payload) });

  it("accepts the owner's verified email", async () => {
    expect(await isOwner("t", verifierFor({ email: "owner@example.com", email_verified: true }))).toBe(true);
  });

  it("ignores case, since Google may capitalise the address", async () => {
    expect(await isOwner("t", verifierFor({ email: "Owner@Example.com", email_verified: "true" }))).toBe(true);
  });

  it.each([
    [{ email: "someone@example.com", email_verified: true }],
    [{ email: "owner@example.com", email_verified: false }],
    [{ email: "owner@example.com", email_verified: "false" }],
    [{ email: "owner@example.com" }],
    [{ email_verified: true }],
  ])("refuses %j", async (payload) => {
    expect(await isOwner("t", verifierFor(payload))).toBe(false);
  });

  it("refuses a token that does not verify", async () => {
    expect(await isOwner("t", { verify: vi.fn(async () => { throw new Error("bad sig"); }) })).toBe(false);
  });

  it("names the missing variable when OWNER_EMAIL is not set", async () => {
    delete process.env.OWNER_EMAIL;
    await expect(
      isOwner("t", verifierFor({ email: "owner@example.com", email_verified: true })),
    ).rejects.toThrow("OWNER_EMAIL is not set");
  });
});
