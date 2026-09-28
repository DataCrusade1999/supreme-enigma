import { NextRequest, NextResponse } from "next/server";
import { authorizeUrl, pkcePair, randomState, safeNext } from "@/lib/cognito";
import { createOAuthState, OAUTH_COOKIE, OAUTH_STATE_MAX_AGE_MS } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const state = randomState();
  const { verifier, challenge } = pkcePair();
  const redirectUri = `${request.nextUrl.origin}/api/auth/callback`;

  const response = NextResponse.redirect(authorizeUrl({ redirectUri, state, challenge }));
  response.cookies.set(OAUTH_COOKIE, createOAuthState({ state, verifier, next }, process.env.COOKIE_SECRET!), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: OAUTH_STATE_MAX_AGE_MS / 1000,
  });
  return response;
}
