import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/cognito", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cognito")>()),
  exchangeCode: vi.fn(),
  verifyIdToken: vi.fn(),
}));

import { exchangeCode, verifyIdToken } from "@/lib/cognito";
import { ID_COOKIE, REFRESH_COOKIE, unseal } from "@/lib/auth";
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
  it("signs any verified user in and sends them where they were going", async () => {
    vi.mocked(exchangeCode).mockResolvedValue({ idToken: "idtok", refreshToken: "rt" });
    vi.mocked(verifyIdToken).mockResolvedValue(true);

    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));

    expect(redirectedTo(res)).toBe("/tools/news-desk");
    expect(exchangeCode).toHaveBeenCalledWith({
      code: "c",
      verifier: "ver",
      redirectUri: "https://site.example/api/auth/callback",
    });
    expect(verifyIdToken).toHaveBeenCalledWith("idtok");
    expect(unseal(res.cookies.get(ID_COOKIE)!.value, "secret")).toBe("idtok");
    expect(unseal(res.cookies.get(REFRESH_COOKIE)!.value, "secret")).toBe("rt");
    expect(res.cookies.get(OAUTH_COOKIE)!.value).toBe("");
  });

  // Cognito's /passkeys/add returns ?result=… and neither echoes state nor sends a code.
  it("sends a finished passkey setup to the hub", async () => {
    const res = await callback({ result: "success" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/tools?passkey=added");
    expect(res.cookies.get(OAUTH_COOKIE)!.value).toBe("");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(res.cookies.get(ID_COOKIE)).toBeUndefined();
  });

  it.each(["invalid_session", "<script>"])("reports any other passkey result (%j) as not added", async (result) => {
    const res = await callback({ result }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/tools?passkey=failed");
  });

  it("ignores a passkey result this browser did not start", async () => {
    const res = await callback({ result: "success" });
    expect(redirectedTo(res)).toBe("/login?error=state");
  });

  it("ignores a passkey result whose state belongs to another sign-in", async () => {
    const res = await callback({ result: "success", state: "other" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=state");
  });

  it("accepts a passkey result that echoes the matching state", async () => {
    const res = await callback({ result: "success", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/tools?passkey=added");
  });

  it("refuses a callback with no state cookie", async () => {
    const res = await callback({ code: "c", state: "s1" });
    expect(redirectedTo(res)).toBe("/login?error=state");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(res.cookies.get(ID_COOKIE)).toBeUndefined();
  });

  it("refuses a state from another sign-in", async () => {
    const res = await callback({ code: "c", state: "other" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=state");
    expect(res.cookies.get(ID_COOKIE)).toBeUndefined();
  });

  it("reports a sign-in Cognito cancelled", async () => {
    const res = await callback({ error: "access_denied", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=denied");
  });

  it("refuses a token that fails verification", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(exchangeCode).mockResolvedValue({ idToken: "idtok", refreshToken: "rt" });
    vi.mocked(verifyIdToken).mockResolvedValue(false);

    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=failed");
    expect(res.cookies.get(ID_COOKIE)).toBeUndefined();
  });

  it("reports a cancel as cancelled even when the state cookie has expired", async () => {
    const res = await callback({ error: "access_denied", state: "s1" });
    expect(redirectedTo(res)).toBe("/login?error=denied");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(res.cookies.get(ID_COOKIE)).toBeUndefined();
  });

  it("redirects rather than failing when COOKIE_SECRET is not set", async () => {
    const stateCookie = cookieFor("s1");
    delete process.env.COOKIE_SECRET;
    const res = await callback({ code: "c", state: "s1" }, stateCookie);
    expect(redirectedTo(res)).toBe("/login?error=failed");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(res.cookies.get(ID_COOKIE)).toBeUndefined();
  });

  it("reports a failed code exchange", async () => {
    vi.mocked(exchangeCode).mockRejectedValue(new Error("token exchange failed: 400"));
    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=failed");
  });
});
