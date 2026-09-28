import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/cognito", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cognito")>()),
  exchangeCode: vi.fn(),
  isOwner: vi.fn(),
}));

import { exchangeCode, isOwner } from "@/lib/cognito";
import { COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth";
import { createOAuthState, OAUTH_COOKIE } from "@/lib/oauth-state";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COOKIE_SECRET = "secret";
});

function callback(query: Record<string, string>, stateCookie?: string) {
  const url = new URL("https://site.example/api/auth/callback");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const req = new NextRequest(url);
  if (stateCookie) req.cookies.set(OAUTH_COOKIE, stateCookie);
  return GET(req);
}

const cookieFor = (state: string, next = "/tools/news-desk") =>
  createOAuthState({ state, verifier: "ver", next }, "secret");

function redirectedTo(res: Response) {
  const url = new URL(res.headers.get("location")!);
  return url.pathname + url.search;
}

describe("GET /api/auth/callback", () => {
  it("signs the owner in and sends them where they were going", async () => {
    vi.mocked(exchangeCode).mockResolvedValue("idtok");
    vi.mocked(isOwner).mockResolvedValue(true);

    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));

    expect(redirectedTo(res)).toBe("/tools/news-desk");
    expect(exchangeCode).toHaveBeenCalledWith({
      code: "c",
      verifier: "ver",
      redirectUri: "https://site.example/api/auth/callback",
    });
    expect(verifySessionCookieValue(res.cookies.get(COOKIE_NAME)!.value, "secret")).toBe(true);
    expect(res.cookies.get(OAUTH_COOKIE)!.value).toBe("");
  });

  it("refuses a callback with no state cookie", async () => {
    const res = await callback({ code: "c", state: "s1" });
    expect(redirectedTo(res)).toBe("/login?error=state");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();
  });

  it("refuses a state from another sign-in", async () => {
    const res = await callback({ code: "c", state: "other" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=state");
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();
  });

  it("reports a sign-in Cognito cancelled", async () => {
    const res = await callback({ error: "access_denied", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=denied");
  });

  it("refuses anyone but the owner", async () => {
    vi.mocked(exchangeCode).mockResolvedValue("idtok");
    vi.mocked(isOwner).mockResolvedValue(false);

    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=not-allowed");
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();
  });

  it("reports a cancel as cancelled even when the state cookie has expired", async () => {
    const res = await callback({ error: "access_denied", state: "s1" });
    expect(redirectedTo(res)).toBe("/login?error=denied");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();
  });

  it("redirects rather than failing when the owner check throws", async () => {
    vi.mocked(exchangeCode).mockResolvedValue("idtok");
    vi.mocked(isOwner).mockRejectedValue(new Error("OWNER_EMAIL is not set"));

    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=failed");
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();
  });

  it("reports a failed code exchange", async () => {
    vi.mocked(exchangeCode).mockRejectedValue(new Error("token exchange failed: 400"));
    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=failed");
  });
});
