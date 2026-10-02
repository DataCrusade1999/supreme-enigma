import { NextRequest, NextResponse } from "next/server";
import { setSessionCookies } from "@/lib/auth";
import { exchangeCode, safeNext, verifyIdToken, type Tokens } from "@/lib/cognito";
import { OAUTH_COOKIE, readOAuthState } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

function toLogin(request: NextRequest, error: string) {
  const response = NextResponse.redirect(new URL(`/login?error=${error}`, request.url));
  response.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    console.error("auth: COOKIE_SECRET is not set");
    return toLogin(request, "failed");
  }

  const params = request.nextUrl.searchParams;
  const saved = readOAuthState(request.cookies.get(OAUTH_COOKIE)?.value, secret);

  // /passkeys/add returns ?result=… with no code, so there is nothing to
  // exchange: the owner is already signed in here. It did not echo state when
  // we probed it, so the signed cookie that /api/auth/passkey set is what shows
  // this browser started the setup; a state, if one comes back, must match it.
  // Only the two outcomes are passed on, never Cognito's value itself.
  const result = params.get("result");
  if (result !== null && !params.has("code")) {
    if (!saved || (params.has("state") && params.get("state") !== saved.state)) {
      return toLogin(request, "state");
    }
    const response = NextResponse.redirect(
      new URL(`/tools?passkey=${result === "success" ? "added" : "failed"}`, request.url),
    );
    response.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
    return response;
  }

  // The state check comes first: without it, anyone could send the owner's
  // browser a callback carrying the attacker's own code. A Cognito error on a
  // failed check only picks the message (a cancel after the cookie expired
  // should say cancelled); nothing is exchanged either way.
  if (!saved || params.get("state") !== saved.state) {
    return toLogin(request, params.get("error") ? "denied" : "state");
  }
  if (params.get("error")) return toLogin(request, "denied");

  const code = params.get("code");
  if (!code) return toLogin(request, "failed");

  let tokens: Tokens;
  try {
    tokens = await exchangeCode({
      code,
      verifier: saved.verifier,
      redirectUri: `${request.nextUrl.origin}/api/auth/callback`,
    });
  } catch (err) {
    console.error("auth: code exchange failed", err);
    return toLogin(request, "failed");
  }

  if (!(await verifyIdToken(tokens.idToken))) {
    console.error("auth: the ID token from the code exchange failed verification");
    return toLogin(request, "failed");
  }

  // saved.next was cleaned by the login route and is signed, but this is the
  // redirect that matters, so it is cleaned again here. Any Cognito user gets a
  // session; the proxy asks Verified Permissions what the session may open.
  const response = NextResponse.redirect(new URL(safeNext(saved.next), request.url));
  response.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  setSessionCookies(response, tokens, secret);
  return response;
}
