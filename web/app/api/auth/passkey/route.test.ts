import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { OAUTH_COOKIE, readOAuthState } from "@/lib/oauth-state";

beforeEach(() => {
  process.env.COGNITO_DOMAIN = "https://login.example.com";
  process.env.COGNITO_CLIENT_ID = "client123";
  process.env.COOKIE_SECRET = "secret";
});

describe("GET /api/auth/passkey", () => {
  it("redirects to Cognito's passkey page with a state that matches the cookie", async () => {
    const res = await GET(new NextRequest("https://site.example/api/auth/passkey"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://login.example.com/passkeys/add");
    expect(location.searchParams.get("client_id")).toBe("client123");
    expect(location.searchParams.get("redirect_uri")).toBe("https://site.example/api/auth/callback");

    const saved = readOAuthState(res.cookies.get(OAUTH_COOKIE)!.value, "secret")!;
    expect(saved.state).toBe(location.searchParams.get("state"));
    expect(saved.next).toBe("/tools");
  });
});
