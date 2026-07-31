import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionCookieValue } from "./lib/auth";
import { isGatedPath } from "./lib/route-gate";

export const runtime = "nodejs";

export function middleware(request: NextRequest) {
  if (!isGatedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  const secret = process.env.COOKIE_SECRET!;

  if (!verifySessionCookieValue(cookie, secret)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/tools/bgm-looper/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
