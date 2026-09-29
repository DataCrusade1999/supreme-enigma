import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, createSessionCookieValue } from "@/lib/auth";
import { exchangeCode, isOwner, safeNext } from "@/lib/cognito";
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

  // /passkeys/add returns ?result=… with no code and no state, so there is
  // nothing to check or exchange: the owner is already signed in here. Only the
  // two outcomes are passed on, never Cognito's value itself.
  const result = params.get("result");
  if (result !== null && !params.has("code")) {
    const response = NextResponse.redirect(
      new URL(`/tools?passkey=${result === "success" ? "added" : "failed"}`, request.url),
    );
    response.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
    return response;
  }

  const saved = readOAuthState(request.cookies.get(OAUTH_COOKIE)?.value, secret);

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

  let idToken: string;
  try {
    idToken = await exchangeCode({
      code,
      verifier: saved.verifier,
      redirectUri: `${request.nextUrl.origin}/api/auth/callback`,
    });
  } catch (err) {
    console.error("auth: code exchange failed", err);
    return toLogin(request, "failed");
  }

  let owner: boolean;
  try {
    owner = await isOwner(idToken);
  } catch (err) {
    console.error("auth: owner check failed", err);
    return toLogin(request, "failed");
  }
  if (!owner) return toLogin(request, "not-allowed");

  // saved.next was cleaned by the login route and is signed, but this is the
  // redirect that matters, so it is cleaned again here.
  const response = NextResponse.redirect(new URL(safeNext(saved.next), request.url));
  response.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  // Same cookie and attributes the password route set, so proxy.ts is unchanged.
  response.cookies.set(COOKIE_NAME, createSessionCookieValue(secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
