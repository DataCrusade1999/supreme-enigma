import { NextRequest, NextResponse } from "next/server";
import { authorizeUrl, pkcePair, randomState, safeNext } from "@/lib/cognito";
import { createOAuthState, OAUTH_COOKIE, OAUTH_STATE_MAX_AGE_MS } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    console.error("auth: COOKIE_SECRET is not set");
    return NextResponse.redirect(new URL("/login?error=failed", request.url));
  }

  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const state = randomState();
  const { verifier, challenge } = pkcePair();
  const redirectUri = `${request.nextUrl.origin}/api/auth/callback`;

  let target: string;
  try {
    target = authorizeUrl({ redirectUri, state, challenge });
  } catch (err) {
    // COGNITO_DOMAIN missing or malformed: the URL constructor throws.
    console.error("auth: cannot build the Cognito sign-in URL", err);
    return NextResponse.redirect(new URL("/login?error=failed", request.url));
  }

  const response = NextResponse.redirect(target);
  response.cookies.set(OAUTH_COOKIE, createOAuthState({ state, verifier, next }, secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: OAUTH_STATE_MAX_AGE_MS / 1000,
  });
  return response;
}
