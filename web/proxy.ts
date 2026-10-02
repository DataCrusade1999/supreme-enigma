import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookies,
  ID_COOKIE,
  readSession,
  seal,
  sessionFromTokens,
  setSessionCookies,
  type Session,
} from "./lib/auth";
import { refreshIdToken, verifyIdToken } from "./lib/cognito";
import { getAuthorizer, type AuthzContext } from "./lib/authz/authorizer";
import { actionFor, isGatedPath, isMetered, type RouteAction } from "./lib/route-gate";

export type Denial =
  | "no_access"
  | "forbidden"
  | "no_grant"
  | "quota_exhausted"
  | "grant_expired"
  | "authorization_unavailable";

// Refresh a little early, so a token doesn't expire between this check and
// Verified Permissions reading it.
const REFRESH_MARGIN_S = 60;
// Groups that any policy grants anything to. Every Google user is also in an
// automatic "<pool>_Google" group, which no policy mentions.
const MEMBER_GROUPS = ["owner", "friends"];

const isApi = (request: NextRequest) => request.nextUrl.pathname.startsWith("/api/");

function toLogin(request: NextRequest): NextResponse {
  if (isApi(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const loginUrl = new URL("/login", request.url);
  // Built by hand, not searchParams.set(): URLSearchParams escapes "/" too,
  // which RFC 3986 allows unescaped in a query, and ?next=%2Ftools%2F... is
  // unreadable in the address bar. Everything else stays escaped.
  loginUrl.search = "?next=" + encodeURIComponent(request.nextUrl.pathname).replaceAll("%2F", "/");
  return NextResponse.redirect(loginUrl);
}

function deny(request: NextRequest, reason: Denial, route: RouteAction | null): NextResponse {
  if (isApi(request)) {
    return NextResponse.json({ error: reason }, { status: reason === "authorization_unavailable" ? 503 : 403 });
  }
  if (reason === "no_access") return NextResponse.redirect(new URL("/access-requested", request.url));
  const url = new URL("/access-denied", request.url);
  const params = new URLSearchParams({ reason });
  if (route) {
    params.set("tool", route.tool);
    params.set("action", route.action);
  }
  url.search = params.toString();
  return NextResponse.redirect(url);
}

/** The session, with its ID token refreshed if it has a minute or less left.
 * Null means signed out: no cookie, or a refresh that failed. */
async function currentSession(
  request: NextRequest,
  secret: string,
): Promise<{ session: Session; refreshed: boolean } | null> {
  const session = readSession(request.cookies, secret);
  if (!session) return null;
  if (session.expiresAt - Math.floor(Date.now() / 1000) > REFRESH_MARGIN_S) return { session, refreshed: false };
  if (!session.refreshToken) return null;
  try {
    const idToken = await refreshIdToken(session.refreshToken);
    if (!(await verifyIdToken(idToken))) {
      console.error("auth: a refreshed ID token failed verification");
      return null;
    }
    const fresh = sessionFromTokens(idToken, session.refreshToken);
    return fresh ? { session: fresh, refreshed: true } : null;
  } catch (err) {
    // Revoked (the member was removed) or past 7 days: sign in again.
    console.error("auth: token refresh failed", err);
    return null;
  }
}

async function decide(request: NextRequest, session: Session): Promise<NextResponse> {
  if (!session.groups.some((group) => MEMBER_GROUPS.includes(group))) {
    return deny(request, "no_access", null);
  }
  const route = actionFor(request.method, request.nextUrl.pathname);
  if (!route) return deny(request, "forbidden", null);

  const context: AuthzContext = { now: Math.floor(Date.now() / 1000) };
  // Part 2 (grants) reads the user's grant for metered actions here.

  let decision;
  try {
    decision = await getAuthorizer().isAuthorized({ session, tool: route.tool, action: route.action, context });
  } catch (err) {
    console.error("authz: no decision", err);
    return deny(request, "authorization_unavailable", route);
  }
  if (decision !== "allow") return deny(request, isMetered(route.action) ? "no_grant" : "forbidden", route);
  return NextResponse.next();
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (!isGatedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    console.error("auth: COOKIE_SECRET is not set");
    return deny(request, "authorization_unavailable", null);
  }

  const current = await currentSession(request, secret);
  if (!current) {
    const response = toLogin(request);
    clearSessionCookies(response);
    return response;
  }

  if (!current.refreshed) return decide(request, current.session);

  // Pages and route handlers read cookies() from the request, after this runs,
  // so the new token goes into the request's cookie header as well as the
  // response's Set-Cookie.
  request.cookies.set(ID_COOKIE, seal(current.session.idToken, secret));
  const decided = await decide(request, current.session);
  const response =
    decided.headers.get("x-middleware-next") === "1"
      ? NextResponse.next({ request: { headers: request.headers } })
      : decided;
  setSessionCookies(response, { idToken: current.session.idToken }, secret);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
