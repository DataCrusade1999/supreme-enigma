import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSessionCookieValue, COOKIE_NAME } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

function clientKey(request: NextRequest): string {
  // Vercel sets x-forwarded-for; the first entry is the client. Fall back to a
  // constant so a missing header fails closed into one shared bucket rather than
  // handing every request its own unlimited allowance.
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(clientKey(request));
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
