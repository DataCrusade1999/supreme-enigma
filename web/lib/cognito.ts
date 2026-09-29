import { createHash, randomBytes } from "crypto";
import { CognitoJwtVerifier } from "aws-jwt-verify";

const FALLBACK = "/tools";
// Only resolved against, never visited: it stands in for "this site".
const SAME_ORIGIN = "https://same-origin.invalid";

/** Where to go after sign-in: a same-origin path, or the tools hub. Resolved the
 * way the browser will resolve the redirect, because a prefix check is not
 * enough: the parser strips tabs and newlines and reads "\" as "/", so "/\t/x"
 * and "/\x" both become "//x", another host. The login page's parseNext does
 * the same for the same reason. */
export function safeNext(value: string | null): string {
  if (!value?.startsWith("/")) return FALLBACK;
  try {
    const url = new URL(value, SAME_ORIGIN);
    if (url.origin !== SAME_ORIGIN) return FALLBACK;
    return url.pathname + url.search + url.hash;
  } catch {
    return FALLBACK;
  }
}

export function randomState(): string {
  return randomBytes(16).toString("base64url");
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** `path` is the managed-login page: sign-in by default, or /passkeys/add, which
 * takes the same parameters. */
export function authorizeUrl(p: {
  redirectUri: string;
  state: string;
  challenge: string;
  path?: "/oauth2/authorize" | "/passkeys/add";
}): string {
  const url = new URL(`${process.env.COGNITO_DOMAIN}${p.path ?? "/oauth2/authorize"}`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.COGNITO_CLIENT_ID!,
    redirect_uri: p.redirectUri,
    scope: "openid email",
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** Trades the authorization code for tokens and returns the ID token. Public
 * client: the PKCE verifier stands in for a client secret. */
export async function exchangeCode(p: { code: string; verifier: string; redirectUri: string }): Promise<string> {
  const res = await fetch(`${process.env.COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.COGNITO_CLIENT_ID!,
      code: p.code,
      redirect_uri: p.redirectUri,
      code_verifier: p.verifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const { id_token } = await res.json();
  return id_token;
}

export type IdTokenVerifier = { verify(token: string): Promise<Record<string, unknown>> };

function defaultVerifier(): IdTokenVerifier {
  // Checks signature (against the pool's JWKS), issuer, audience, token_use and expiry.
  return CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    tokenUse: "id",
    clientId: process.env.COGNITO_CLIENT_ID!,
  }) as unknown as IdTokenVerifier;
}

/** Google sign-in creates a Cognito user for any Google account, so this is the
 * only thing standing between another account and a session. */
export async function isOwner(idToken: string, verifier: IdTokenVerifier = defaultVerifier()): Promise<boolean> {
  // A thrown error, not false: refusing the owner as "not allowed" would hide a
  // missing env var behind the message for someone else's account.
  const owner = process.env.OWNER_EMAIL;
  if (!owner) throw new Error("OWNER_EMAIL is not set");

  let payload: Record<string, unknown>;
  try {
    payload = await verifier.verify(idToken);
  } catch {
    return false;
  }
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  const verified = payload.email_verified === true || payload.email_verified === "true";
  return verified && email !== null && email === owner.toLowerCase();
}
