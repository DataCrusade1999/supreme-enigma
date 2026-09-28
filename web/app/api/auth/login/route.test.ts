import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { OAUTH_COOKIE, readOAuthState } from "@/lib/oauth-state";

beforeEach(() => {
  process.env.COGNITO_DOMAIN = "https://login.example.com";
  process.env.COGNITO_CLIENT_ID = "client123";
  process.env.COOKIE_SECRET = "secret";
});

function get(next?: string) {
  const url = new URL("https://site.example/api/auth/login");
  if (next !== undefined) url.searchParams.set("next", next);
  return GET(new NextRequest(url));
}

describe("GET /api/auth/login", () => {
  it("redirects to Cognito with a state that matches the cookie", async () => {
    const res = await get("/tools/news-desk");
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://login.example.com");
    expect(location.searchParams.get("redirect_uri")).toBe("https://site.example/api/auth/callback");

    const cookie = res.cookies.get(OAUTH_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.path).toBe("/api/auth");
    const saved = readOAuthState(cookie.value, "secret")!;
    expect(saved.state).toBe(location.searchParams.get("state"));
    expect(saved.next).toBe("/tools/news-desk");
  });

  it("sends the browser back to /login rather than failing when Cognito is not configured", async () => {
    delete process.env.COGNITO_DOMAIN;
    const res = await get("/tools");
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe(
      "/login?error=failed",
    );
    expect(res.cookies.get(OAUTH_COOKIE)).toBeUndefined();
  });

  it.each(["//evil.example", "https://evil.example", "/\t/evil.example", undefined])("replaces next=%j with the hub", async (next) => {
    const res = await get(next);
    expect(readOAuthState(res.cookies.get(OAUTH_COOKIE)!.value, "secret")!.next).toBe("/tools");
  });
});
