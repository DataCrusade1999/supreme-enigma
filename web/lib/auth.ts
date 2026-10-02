import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "crypto";

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

// --- Token session (spec 2026-09-29-access-control-design.md §5) ---
//
// The session is the user's Cognito tokens: Verified Permissions needs the ID
// token for every decision, and the refresh token renews it every 15 minutes.
// The refresh token is a credential, so both cookies are encrypted, not only
// signed. Two cookies because together they come close to the 4 KB limit.

export const ID_COOKIE = "site_id";
export const REFRESH_COOKIE = "site_refresh";
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

function sessionKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", "site-session-v1", 32));
}

/** AES-256-GCM, as base64url(iv | tag | ciphertext). */
export function seal(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal(sealed: string | undefined, secret: string): string | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** A JWT's payload, unverified. Only used on tokens that were verified before
 * they were sealed, so the cookie's encryption is what vouches for them. */
export function decodeClaims(jwt: string): Record<string, unknown> | null {
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export type Session = {
  idToken: string;
  refreshToken: string | null;
  sub: string;
  email: string | null;
  /** Cognito group names, without the pool prefix. Empty for a user in none. */
  groups: string[];
  /** The ID token's exp, in epoch seconds. */
  expiresAt: number;
};

export function sessionFromTokens(idToken: string, refreshToken: string | null): Session | null {
  const claims = decodeClaims(idToken);
  if (!claims || typeof claims.sub !== "string" || typeof claims.exp !== "number") return null;
  const rawGroups = claims["cognito:groups"];
  const groups = Array.isArray(rawGroups) ? rawGroups.filter((g): g is string => typeof g === "string") : [];
  return {
    idToken,
    refreshToken,
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    groups,
    expiresAt: claims.exp,
  };
}

type CookieReader = { get(name: string): { value: string } | undefined };
type CookieWriter = { cookies: { set(name: string, value: string, options: object): unknown } };

export function readSession(cookies: CookieReader, secret: string): Session | null {
  const idToken = unseal(cookies.get(ID_COOKIE)?.value, secret);
  if (!idToken) return null;
  return sessionFromTokens(idToken, unseal(cookies.get(REFRESH_COOKIE)?.value, secret));
}

const SESSION_COOKIE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

export function setSessionCookies(
  response: CookieWriter,
  tokens: { idToken: string; refreshToken?: string },
  secret: string,
): void {
  response.cookies.set(ID_COOKIE, seal(tokens.idToken, secret), { ...SESSION_COOKIE, maxAge: SESSION_MAX_AGE_S });
  if (tokens.refreshToken) {
    response.cookies.set(REFRESH_COOKIE, seal(tokens.refreshToken, secret), { ...SESSION_COOKIE, maxAge: SESSION_MAX_AGE_S });
  }
}

export function clearSessionCookies(response: CookieWriter): void {
  response.cookies.set(ID_COOKIE, "", { ...SESSION_COOKIE, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...SESSION_COOKIE, maxAge: 0 });
}
