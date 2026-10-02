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

export type Tokens = { idToken: string; refreshToken: string };

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${process.env.COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.COGNITO_CLIENT_ID!, ...params }).toString(),
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return res.json();
}

/** Trades the authorization code for tokens. Public client: the PKCE verifier
 * stands in for a client secret. */
export async function exchangeCode(p: { code: string; verifier: string; redirectUri: string }): Promise<Tokens> {
  const body = await tokenRequest({
    grant_type: "authorization_code",
    code: p.code,
    redirect_uri: p.redirectUri,
    code_verifier: p.verifier,
  });
  if (typeof body.id_token !== "string" || typeof body.refresh_token !== "string") {
    throw new Error("token exchange returned no tokens");
  }
  return { idToken: body.id_token, refreshToken: body.refresh_token };
}

/** A new ID token for a refresh token. Cognito doesn't rotate refresh tokens
 * for this client, so the refresh cookie stays as it is. */
export async function refreshIdToken(refreshToken: string): Promise<string> {
  const body = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (typeof body.id_token !== "string") throw new Error("token refresh returned no ID token");
  return body.id_token;
}

export type IdTokenVerifier = { verify(token: string): Promise<Record<string, unknown>> };

let verifier: IdTokenVerifier | null = null;

// One instance per process, so the pool's JWKS is fetched once and cached.
function defaultVerifier(): IdTokenVerifier {
  // Checks signature (against the pool's JWKS), issuer, audience, token_use and expiry.
  return (verifier ??= CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    tokenUse: "id",
    clientId: process.env.COGNITO_CLIENT_ID!,
  }) as unknown as IdTokenVerifier);
}

/** Whether a token really came from this pool and client and hasn't expired.
 * Who may do what is Verified Permissions' decision, not this one. */
export async function verifyIdToken(idToken: string, v: IdTokenVerifier = defaultVerifier()): Promise<boolean> {
  try {
    await v.verify(idToken);
    return true;
  } catch {
    return false;
  }
}
