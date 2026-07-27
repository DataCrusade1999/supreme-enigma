import { createHmac, timingSafeEqual } from "crypto";

export const COOKIE_NAME = "looper_session";

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function createSessionCookieValue(secret: string): string {
  const payload = "authenticated";
  const sig = sign(payload, secret);
  return `${payload}.${sig}`;
}

export function verifySessionCookieValue(
  cookieValue: string | undefined,
  secret: string,
): boolean {
  if (!cookieValue) return false;
  const [payload, sig] = cookieValue.split(".");
  if (!payload || !sig) return false;

  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function checkPassword(submitted: string, actual: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
