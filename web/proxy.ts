import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionCookieValue } from "./lib/auth";
import { isGatedPath } from "./lib/route-gate";

export function proxy(request: NextRequest) {
  if (!isGatedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  const secret = process.env.COOKIE_SECRET!;

  if (!verifySessionCookieValue(cookie, secret)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    // Built by hand, not searchParams.set(): URLSearchParams escapes "/" too,
    // which RFC 3986 allows unescaped in a query, and ?next=%2Ftools%2F... is
    // unreadable in the address bar. Everything else stays escaped.
    loginUrl.search =
      "?next=" + encodeURIComponent(request.nextUrl.pathname).replaceAll("%2F", "/");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
