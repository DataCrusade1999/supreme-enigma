import { createHmac, timingSafeEqual } from "crypto";

export type OAuthState = { state: string; verifier: string; next: string };

export const OAUTH_COOKIE = "looper_oauth";
export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** What /api/auth/login hands to /api/auth/callback through the browser: the CSRF
 * state, the PKCE verifier and where to go afterwards. Signed like the session
 * cookie, and short-lived. */
export function createOAuthState(payload: OAuthState, secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, issuedAt: now })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function readOAuthState(
  value: string | undefined,
  secret: string,
  now = Date.now(),
): OAuthState | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const { state, verifier, next, issuedAt } = JSON.parse(Buffer.from(body, "base64url").toString());
    const age = now - issuedAt;
    if (typeof issuedAt !== "number" || age < 0 || age >= OAUTH_STATE_MAX_AGE_MS) return null;
    if (![state, verifier, next].every((v) => typeof v === "string")) return null;
    return { state, verifier, next };
  } catch {
    return null;
  }
}
