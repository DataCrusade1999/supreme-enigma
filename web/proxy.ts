import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionCookieValue } from "./lib/auth";
import { isGatedPath } from "./lib/route-gate";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/authz-spike") {
    const out: Record<string, unknown> = {
      oidcHeader: request.headers.has("x-vercel-oidc-token"),
      oidcEnv: Boolean(process.env.VERCEL_OIDC_TOKEN),
    };
    try {
      const { awsCredentialsProvider } = await import("@vercel/oidc-aws-credentials-provider");
      const creds = await awsCredentialsProvider({ roleArn: process.env.APP_AWS_ROLE_ARN! })();
      out.provider = "ok";
      out.temporary = creds.accessKeyId.startsWith("ASIA");
    } catch (err) {
      out.provider = String(err);
    }
    return NextResponse.json(out);
  }

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
