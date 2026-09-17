import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSessionCookieValue, COOKIE_NAME } from "@/lib/auth";
import { checkRateLimit, clearRateLimit, clientKey } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  // Gated before the password is read, so the cap is on guesses rather than on
  // error responses. A correct password refunds the window below.
  const key = clientKey(request.headers);
  const limit = checkRateLimit(key);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "too many attempts" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { password } = await request.json();

  if (!checkPassword(password ?? "", process.env.APP_PASSWORD!)) {
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  // Right password: hand the budget back, so repeatedly signing in legitimately
  // never locks the owner out of their own site.
  clearRateLimit(key);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    COOKIE_NAME,
    createSessionCookieValue(process.env.COOKIE_SECRET!),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    },
  );
  return response;
}
