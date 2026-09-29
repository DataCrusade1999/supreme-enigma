import { NextRequest, NextResponse } from "next/server";
import { authorizeUrl, pkcePair, randomState } from "@/lib/cognito";
import { createOAuthState, OAUTH_COOKIE, OAUTH_STATE_MAX_AGE_MS } from "@/lib/oauth-state";

/** Sends the browser to a managed-login page with a fresh state and PKCE pair,
 * saved in the signed looper_oauth cookie for /api/auth/callback. `next` must
 * already be cleaned with safeNext. */
export function redirectToCognito(
  request: NextRequest,
  next: string,
  path?: "/oauth2/authorize" | "/passkeys/add",
) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    console.error("auth: COOKIE_SECRET is not set");
    return NextResponse.redirect(new URL("/login?error=failed", request.url));
  }

  const state = randomState();
  const { verifier, challenge } = pkcePair();
  const redirectUri = `${request.nextUrl.origin}/api/auth/callback`;

  let target: string;
  try {
    target = authorizeUrl({ redirectUri, state, challenge, path });
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
