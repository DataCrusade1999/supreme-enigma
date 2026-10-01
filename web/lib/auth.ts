import { createHmac, timingSafeEqual } from "crypto";

export const COOKIE_NAME = "looper_session";

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// The cookie carries its own issue time, signed alongside the rest. Previously the
// signed payload was the constant "authenticated", so every session produced a
// byte-identical cookie that stayed valid until COOKIE_SECRET was rotated — the
// maxAge set on the response was only a browser-side hint.
export function createSessionCookieValue(secret: string, now = Date.now()): string {
  const issuedAt = String(now);
  return `${issuedAt}.${sign(issuedAt, secret)}`;
}

export function verifySessionCookieValue(
  cookieValue: string | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (!cookieValue) return false;

  const [issuedAt, sig] = cookieValue.split(".");
  if (!issuedAt || !sig) return false;

  const expected = sign(issuedAt, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Both sides are hex digests of a fixed width, so this length check only fires
  // on a malformed cookie and leaks nothing about the secret.
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  const issuedAtMs = Number(issuedAt);
  if (!Number.isFinite(issuedAtMs)) return false;

  const age = now - issuedAtMs;
  return age >= 0 && age < SESSION_MAX_AGE_MS;
}
