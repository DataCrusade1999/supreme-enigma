# Cognito Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared `APP_PASSWORD` with owner-only sign-in through Cognito managed login (Google, email code, passkey), keeping the existing signed session cookie and proxy.

**Architecture:** `/login` links to `/api/auth/login`, which stores `{state, PKCE verifier, next}` in a signed 10-minute cookie and redirects to Cognito's `/oauth2/authorize`. `/api/auth/callback` checks state, exchanges the code with the verifier, verifies the ID token with `aws-jwt-verify`, requires the owner's verified email, and sets the same `looper_session` cookie the password route set. Terraform creates an Essentials user pool that sends email codes through phase 4's SES identity.

**Tech Stack:** Terraform `aws` ~> 6.62 (Cognito user pool tiers, sign-in policy, managed login v2); Next.js 16 route handlers; `aws-jwt-verify`; Node `crypto`; Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-cognito-login-design.md`. Issue #290, epic #285.

**Starts after:** phase 4 Task 1 (`aws_sesv2_email_identity.domain` and `.owner` exist and are verified).

## Global Constraints

- Cookie names: session `looper_session` (unchanged, `COOKIE_NAME`); OAuth state `looper_oauth`, path `/api/auth`, `maxAge` 600s, httpOnly, secure, sameSite lax.
- Routes: `GET /api/auth/login?next=…`, `GET /api/auth/callback?code&state` (or `?error`).
- Login error codes in `/login?error=`: `state`, `denied`, `not-allowed`, `failed`.
- `safeNext`: a value starting with `/` but not `//` or `/\`; anything else → `/tools`.
- Scopes `openid email`; `code_challenge_method=S256`; public client, no secret.
- Env vars: `COGNITO_DOMAIN` (full `https://…amazoncognito.com`, no trailing slash), `COGNITO_CLIENT_ID`, `COGNITO_USER_POOL_ID`, `OWNER_EMAIL`, plus existing `COOKIE_SECRET`.
- Cognito prefix domain `ashutosh-pandey-login`. Callback hosts: `ashutosh-pandey.com`, `dev.ashutosh-pandey.com`, `stage.ashutosh-pandey.com` (https) and `localhost:3000` (http).
- Owner check: `payload.email.toLowerCase() === OWNER_EMAIL.toLowerCase()` and `payload.email_verified` is `true` or `"true"`.
- Terraform: plan against real state, apply with the owner's go-ahead before merge, then `No changes.`.
- Commits end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.

## Review Focus

- **Open redirect through `next`** (`//evil.example`, `https://evil.example`, `/\evil.example`): must land on `/tools`. Tests in Task 3 (`safeNext`) and Task 4 (login route).
- **A callback without the state cookie, or with another tab's state**: must not set a session. Tests in Task 4.
- **Another person's Google account**: Cognito signs them in (federated users are auto-created); the callback must refuse and set no session. Test in Task 4.
- **The owner's email in a different case from Google** (`Owner@Gmail.com`): must be accepted. Test in Task 3.
- **Google sending `email_verified` as the string `"false"`**: must be refused. Test in Task 3.

## PR order

| PR | Branch | Tasks | Merge only after |
|---|---|---|---|
| A | `feat/cognito-infra` | 1 | phase 4 Task 1 applied and the SES identities verified |
| B | `feat/cognito-login` | 2, 3, 4, 5, 6 | PR A applied |
| C | `chore/remove-app-password` | 7 | PR B on `main` |

---

## PR A — User pool, Google, client, owner

### Task 1: Cognito in Terraform

**Files:**
- Create: `infra/main/auth.tf`
- Modify: `infra/main/variables.tf`, `infra/main/terraform.tfvars.example`, `CLAUDE.md`

**Interfaces:**
- Consumes: `aws_sesv2_email_identity.domain`, `var.alert_email`, `local.site_hosts` from phase 4 (`email.tf`), `local.env_targets`, `vercel_project.looper`.
- Produces: Vercel env vars `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID`, `COGNITO_USER_POOL_ID`, `OWNER_EMAIL`, which Tasks 3–4 read.

- [ ] **Step 1: Create the Google OAuth client by hand** (Terraform cannot). Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application:
  - Authorized JavaScript origin: `https://ashutosh-pandey-login.auth.us-east-1.amazoncognito.com`
  - Authorized redirect URI: `https://ashutosh-pandey-login.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
  - OAuth consent screen: External, in "Testing" with the owner's Google account as a test user is enough for one user.
  Put the client ID and secret into `infra/main/terraform.tfvars` as `google_client_id` and `google_client_secret`.

- [ ] **Step 2: Variables.** Append to `infra/main/variables.tf`:

```hcl
# Google OAuth client for Cognito's Google sign-in, created by hand in Google Cloud
# Console (spec 2026-09-28-cognito-login-design.md §5).
variable "google_client_id" {
  type = string
}

variable "google_client_secret" {
  type      = string
  sensitive = true
}
```

Append to `infra/main/terraform.tfvars.example`:

```hcl
# Google OAuth client (Web application) used by Cognito for Google sign-in. Its
# redirect URI is https://ashutosh-pandey-login.auth.us-east-1.amazoncognito.com/oauth2/idpresponse.
google_client_id     = "....apps.googleusercontent.com"
google_client_secret = "..."
```

and change its header comment from "until all five are set" to "until all seven are set".

In `CLAUDE.md`'s Commands section, change "has **five required variables, none with a default** — `vercel_api_token`, `app_password`, `github_repo`, `alert_email`, `openrouter_api_key`" to "has **seven required variables, none with a default** — `vercel_api_token`, `app_password`, `github_repo`, `alert_email`, `openrouter_api_key`, `google_client_id`, `google_client_secret`".

- [ ] **Step 3: Write `infra/main/auth.tf`**

```hcl
# Owner-only sign-in for /tools, /keystatic and the gated API routes (spec
# 2026-09-28-cognito-login-design.md). One pool for all three environments, like
# COOKIE_SECRET: the app turns a verified Cognito ID token into its own session.

locals {
  cognito_domain_prefix = "ashutosh-pandey-login"
  cognito_domain_url    = "https://${local.cognito_domain_prefix}.auth.${var.aws_region}.amazoncognito.com"
  login_callback_urls = concat(
    [for h in values(local.site_hosts) : "https://${h}/api/auth/callback"],
    ["http://localhost:3000/api/auth/callback"],
  )
}

resource "aws_cognito_user_pool" "owner" {
  name           = "${var.project_name}-owner"
  user_pool_tier = "ESSENTIALS"
  # No deletion_protection: infra/main must stay destroyable by the kill-switch
  # `terraform destroy`, and a protected pool fails that destroy partway.

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  # PASSWORD is listed so the pool accepts the policy even if AWS requires it; the
  # owner's password is random and never used.
  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD", "EMAIL_OTP", "WEB_AUTHN"]
  }

  web_authn_configuration {
    relying_party_id  = "${local.cognito_domain_prefix}.auth.${var.aws_region}.amazoncognito.com"
    user_verification = "preferred"
  }

  password_policy {
    minimum_length    = 16
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Email codes need SES in DEVELOPER mode (Essentials plan).
  email_configuration {
    email_sending_account = "DEVELOPER"
    source_arn            = aws_sesv2_email_identity.domain.arn
    from_email_address    = "Sign-in <no-reply@${aws_sesv2_email_identity.domain.email_identity}>"
  }

  depends_on = [aws_sesv2_email_identity_policy.cognito]
}

# DEVELOPER mode sends as the domain identity, so the identity has to let Cognito
# do that — and only for this pool.
resource "aws_sesv2_email_identity_policy" "cognito" {
  email_identity = aws_sesv2_email_identity.domain.email_identity
  policy_name    = "cognito-owner-pool"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cognito-idp.amazonaws.com" }
      Action    = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource  = aws_sesv2_email_identity.domain.arn
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/*" }
      }
    }]
  })
}

resource "aws_cognito_user_pool_domain" "owner" {
  domain                = local.cognito_domain_prefix
  user_pool_id          = aws_cognito_user_pool.owner.id
  managed_login_version = 2
}

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.owner.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
  }

  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
    username       = "sub"
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name            = "web"
  user_pool_id    = aws_cognito_user_pool.owner.id
  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  callback_urls                        = local.login_callback_urls
  supported_identity_providers         = ["COGNITO", aws_cognito_identity_provider.google.provider_name]
  explicit_auth_flows                  = ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
}

# Managed login v2 serves no pages for a client without a branding style.
resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id                = aws_cognito_user_pool.owner.id
  client_id                   = aws_cognito_user_pool_client.web.id
  use_cognito_provided_values = true
}

resource "random_password" "owner_cognito" {
  length      = 32
  min_upper   = 1
  min_lower   = 1
  min_numeric = 1
  min_special = 1
}

resource "aws_cognito_user" "owner" {
  user_pool_id   = aws_cognito_user_pool.owner.id
  username       = var.alert_email
  password       = random_password.owner_cognito.result
  message_action = "SUPPRESS"

  attributes = {
    email          = var.alert_email
    email_verified = "true"
  }
}

resource "vercel_project_environment_variable" "cognito_domain" {
  project_id = vercel_project.looper.id
  key        = "COGNITO_DOMAIN"
  value      = local.cognito_domain_url
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "cognito_client_id" {
  project_id = vercel_project.looper.id
  key        = "COGNITO_CLIENT_ID"
  value      = aws_cognito_user_pool_client.web.id
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "cognito_user_pool_id" {
  project_id = vercel_project.looper.id
  key        = "COGNITO_USER_POOL_ID"
  value      = aws_cognito_user_pool.owner.id
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "owner_email" {
  project_id = vercel_project.looper.id
  key        = "OWNER_EMAIL"
  value      = var.alert_email
  target     = local.env_targets
  sensitive  = true
}
```

- [ ] **Step 4: Validate and plan**

Run: `cd infra/main && terraform fmt && terraform validate && terraform plan -var-file=terraform.tfvars`
Expected: creates 1 user pool, 1 identity policy, 1 domain, 1 identity provider, 1 client, 1 branding, 1 password, 1 user, 4 Vercel env vars. No other changes. If `validate` rejects an attribute (`user_pool_tier`, `sign_in_policy`, `web_authn_configuration`, `managed_login_version`, `aws_cognito_managed_login_branding`), check the provider docs for 6.63 (`terraform providers schema -json | node -e …` or the registry page) and adjust the name; do not drop the feature.

- [ ] **Step 5: Commit, PR, apply**

```bash
git add infra/main/auth.tf infra/main/variables.tf infra/main/terraform.tfvars.example CLAUDE.md
git commit -m "feat(infra): Cognito user pool for owner sign-in

Refs #290

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/cognito-infra
gh pr create --base dev --title "feat(infra): Cognito user pool for owner sign-in" --body "Phase 5, PR A of 3 (spec 2026-09-28-cognito-login-design.md). Additive: nothing reads the new env vars yet. Needs google_client_id/google_client_secret in terraform.tfvars. Paste the plan summary here.

Refs #290"
```

With the owner's go-ahead: apply, then plan again. `aws_cognito_user` with `username_attributes = ["email"]` is known to report a `username` diff on the next plan, because Cognito stores the username as the user's `sub`. If the second plan shows only that, add `lifecycle { ignore_changes = [username] }` to `aws_cognito_user.owner` with a one-line comment saying why, and plan again until it shows `No changes.`. Verify managed login renders: open `https://ashutosh-pandey-login.auth.us-east-1.amazoncognito.com/oauth2/authorize?client_id=<client id>&response_type=code&scope=openid+email&redirect_uri=http://localhost:3000/api/auth/callback` — it shows "Continue with Google" and an email field; entering the owner's email offers an email code, which arrives from `no-reply@ashutosh-pandey.com`. The redirect to localhost afterwards fails (nothing is listening); that is expected. Merge per `merging-a-pr`.

---

## PR B — Sign-in routes; password removed from the app

### Task 2: Signed OAuth state cookie

**Files:**
- Create: `web/lib/oauth-state.ts`
- Test: `web/lib/oauth-state.test.ts`

**Interfaces:**
- Produces: `type OAuthState = { state: string; verifier: string; next: string }`; `OAUTH_COOKIE = "looper_oauth"`; `OAUTH_STATE_MAX_AGE_MS = 600_000`; `createOAuthState(payload: OAuthState, secret: string, now?: number): string`; `readOAuthState(value: string | undefined, secret: string, now?: number): OAuthState | null`.

- [ ] **Step 1: Failing tests** `web/lib/oauth-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createOAuthState, OAUTH_STATE_MAX_AGE_MS, readOAuthState } from "./oauth-state";

const SECRET = "test-secret";
const PAYLOAD = { state: "s1", verifier: "v1", next: "/tools/news-desk" };

describe("oauth state cookie", () => {
  it("round-trips", () => {
    const value = createOAuthState(PAYLOAD, SECRET, 1_000);
    expect(readOAuthState(value, SECRET, 2_000)).toEqual(PAYLOAD);
  });

  it("rejects a value signed with another secret", () => {
    expect(readOAuthState(createOAuthState(PAYLOAD, "other", 1_000), SECRET, 2_000)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [, sig] = createOAuthState(PAYLOAD, SECRET, 1_000).split(".");
    const forged = Buffer.from(JSON.stringify({ ...PAYLOAD, next: "//evil", issuedAt: 1_000 })).toString("base64url");
    expect(readOAuthState(`${forged}.${sig}`, SECRET, 2_000)).toBeNull();
  });

  it("expires after ten minutes", () => {
    const value = createOAuthState(PAYLOAD, SECRET, 0);
    expect(readOAuthState(value, SECRET, OAUTH_STATE_MAX_AGE_MS - 1)).toEqual(PAYLOAD);
    expect(readOAuthState(value, SECRET, OAUTH_STATE_MAX_AGE_MS)).toBeNull();
  });

  it.each([undefined, "", "no-dot", "a.b.c", "!!!.deadbeef"])("rejects malformed %s", (value) => {
    expect(readOAuthState(value, SECRET, 0)).toBeNull();
  });
});
```

Run: `cd web && npx vitest run lib/oauth-state.test.ts` — Expected: FAIL (no module).

- [ ] **Step 2: Implement** `web/lib/oauth-state.ts`:

```ts
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
```

Run: `cd web && npx vitest run lib/oauth-state.test.ts` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/lib/oauth-state.ts web/lib/oauth-state.test.ts
git commit -m "feat(web): signed short-lived OAuth state cookie

Refs #290

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 3: Cognito helpers

**Files:**
- Modify: `web/package.json`, `web/package-lock.json` (add `aws-jwt-verify`)
- Create: `web/lib/cognito.ts`
- Test: `web/lib/cognito.test.ts`

**Interfaces:**
- Produces: `safeNext(value: string | null): string`; `pkcePair(): { verifier: string; challenge: string }`; `randomState(): string`; `authorizeUrl(p: { redirectUri: string; state: string; challenge: string }): string`; `exchangeCode(p: { code: string; verifier: string; redirectUri: string }): Promise<string>` (the ID token); `type IdTokenVerifier = { verify(token: string): Promise<Record<string, unknown>> }`; `isOwner(idToken: string, verifier?: IdTokenVerifier): Promise<boolean>`.

- [ ] **Step 1: Install** — `cd web && npm install aws-jwt-verify`

- [ ] **Step 2: Failing tests** `web/lib/cognito.test.ts`:

```ts
import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeUrl, exchangeCode, isOwner, pkcePair, safeNext } from "./cognito";

beforeEach(() => {
  process.env.COGNITO_DOMAIN = "https://login.example.com";
  process.env.COGNITO_CLIENT_ID = "client123";
  process.env.COGNITO_USER_POOL_ID = "us-east-1_pool";
  process.env.OWNER_EMAIL = "owner@example.com";
});

describe("safeNext", () => {
  it.each([
    ["/tools/news-desk", "/tools/news-desk"],
    ["/keystatic?path=posts#x", "/keystatic?path=posts#x"],
    [null, "/tools"],
    ["", "/tools"],
    ["//evil.example", "/tools"],
    ["/\\evil.example", "/tools"],
    ["https://evil.example", "/tools"],
    ["tools", "/tools"],
  ])("%s -> %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe("pkcePair", () => {
  it("derives the S256 challenge from the verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
});

describe("authorizeUrl", () => {
  it("asks for an authorization code with PKCE", () => {
    const url = new URL(authorizeUrl({ redirectUri: "https://site/api/auth/callback", state: "st", challenge: "ch" }));
    expect(url.origin + url.pathname).toBe("https://login.example.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client123",
      redirect_uri: "https://site/api/auth/callback",
      scope: "openid email",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
  });
});

describe("exchangeCode", () => {
  it("posts the code and verifier and returns the ID token", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id_token: "idtok" }) }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeCode({ code: "c", verifier: "v", redirectUri: "https://site/api/auth/callback" })).toBe("idtok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://login.example.com/oauth2/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      grant_type: "authorization_code",
      client_id: "client123",
      code: "c",
      redirect_uri: "https://site/api/auth/callback",
      code_verifier: "v",
    });
  });

  it("throws when Cognito refuses the code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) })));
    await expect(exchangeCode({ code: "c", verifier: "v", redirectUri: "r" })).rejects.toThrow("400");
  });
});

describe("isOwner", () => {
  const verifierFor = (payload: Record<string, unknown>) => ({ verify: vi.fn(async () => payload) });

  it("accepts the owner's verified email", async () => {
    expect(await isOwner("t", verifierFor({ email: "owner@example.com", email_verified: true }))).toBe(true);
  });

  it("ignores case, since Google may capitalise the address", async () => {
    expect(await isOwner("t", verifierFor({ email: "Owner@Example.com", email_verified: "true" }))).toBe(true);
  });

  it.each([
    [{ email: "someone@example.com", email_verified: true }],
    [{ email: "owner@example.com", email_verified: false }],
    [{ email: "owner@example.com", email_verified: "false" }],
    [{ email: "owner@example.com" }],
    [{ email_verified: true }],
  ])("refuses %j", async (payload) => {
    expect(await isOwner("t", verifierFor(payload))).toBe(false);
  });

  it("refuses a token that does not verify", async () => {
    expect(await isOwner("t", { verify: vi.fn(async () => { throw new Error("bad sig"); }) })).toBe(false);
  });
});
```

Run: `cd web && npx vitest run lib/cognito.test.ts` — Expected: FAIL (no module).

- [ ] **Step 3: Implement** `web/lib/cognito.ts`:

```ts
import { createHash, randomBytes } from "crypto";
import { CognitoJwtVerifier } from "aws-jwt-verify";

const FALLBACK = "/tools";

/** Where to go after sign-in: a same-origin path, or the tools hub. "//x" and
 * "/\x" are protocol-relative to a browser, so they are refused too. */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return FALLBACK;
  }
  return value;
}

export function randomState(): string {
  return randomBytes(16).toString("base64url");
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(p: { redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(`${process.env.COGNITO_DOMAIN}/oauth2/authorize`);
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
  let payload: Record<string, unknown>;
  try {
    payload = await verifier.verify(idToken);
  } catch {
    return false;
  }
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  const verified = payload.email_verified === true || payload.email_verified === "true";
  return verified && email !== null && email === process.env.OWNER_EMAIL!.toLowerCase();
}
```

Run: `cd web && npx vitest run lib/cognito.test.ts` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json web/lib/cognito.ts web/lib/cognito.test.ts
git commit -m "feat(web): Cognito OAuth helpers with PKCE and owner check

Refs #290

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 4: `/api/auth/login` and `/api/auth/callback`

**Files:**
- Create: `web/app/api/auth/login/route.ts`, `web/app/api/auth/login/route.test.ts`
- Create: `web/app/api/auth/callback/route.ts`, `web/app/api/auth/callback/route.test.ts`

**Interfaces:**
- Consumes: Task 2 and Task 3 exports; `COOKIE_NAME`, `createSessionCookieValue` from `@/lib/auth`.
- Produces: the two routes the login page (Task 5) links to and Cognito redirects to.

- [ ] **Step 1: Failing tests.** `web/app/api/auth/login/route.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { OAUTH_COOKIE, readOAuthState } from "@/lib/oauth-state";

beforeEach(() => {
  process.env.COGNITO_DOMAIN = "https://login.example.com";
  process.env.COGNITO_CLIENT_ID = "client123";
  process.env.COOKIE_SECRET = "secret";
});

function get(next?: string) {
  const url = new URL("https://site.example/api/auth/login");
  if (next !== undefined) url.searchParams.set("next", next);
  return GET(new NextRequest(url));
}

describe("GET /api/auth/login", () => {
  it("redirects to Cognito with a state that matches the cookie", async () => {
    const res = await get("/tools/news-desk");
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://login.example.com");
    expect(location.searchParams.get("redirect_uri")).toBe("https://site.example/api/auth/callback");

    const cookie = res.cookies.get(OAUTH_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.path).toBe("/api/auth");
    const saved = readOAuthState(cookie.value, "secret")!;
    expect(saved.state).toBe(location.searchParams.get("state"));
    expect(saved.next).toBe("/tools/news-desk");
  });

  it.each(["//evil.example", "https://evil.example", undefined])("replaces next=%s with the hub", async (next) => {
    const res = await get(next);
    expect(readOAuthState(res.cookies.get(OAUTH_COOKIE)!.value, "secret")!.next).toBe("/tools");
  });
});
```

`web/app/api/auth/callback/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/cognito", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cognito")>()),
  exchangeCode: vi.fn(),
  isOwner: vi.fn(),
}));

import { exchangeCode, isOwner } from "@/lib/cognito";
import { COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth";
import { createOAuthState, OAUTH_COOKIE } from "@/lib/oauth-state";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COOKIE_SECRET = "secret";
});

function callback(query: Record<string, string>, stateCookie?: string) {
  const url = new URL("https://site.example/api/auth/callback");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const req = new NextRequest(url);
  if (stateCookie) req.cookies.set(OAUTH_COOKIE, stateCookie);
  return GET(req);
}

const cookieFor = (state: string, next = "/tools/news-desk") =>
  createOAuthState({ state, verifier: "ver", next }, "secret");

function redirectedTo(res: Response) {
  const url = new URL(res.headers.get("location")!);
  return url.pathname + url.search;
}

describe("GET /api/auth/callback", () => {
  it("signs the owner in and sends them where they were going", async () => {
    vi.mocked(exchangeCode).mockResolvedValue("idtok");
    vi.mocked(isOwner).mockResolvedValue(true);

    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));

    expect(redirectedTo(res)).toBe("/tools/news-desk");
    expect(exchangeCode).toHaveBeenCalledWith({
      code: "c",
      verifier: "ver",
      redirectUri: "https://site.example/api/auth/callback",
    });
    expect(verifySessionCookieValue(res.cookies.get(COOKIE_NAME)!.value, "secret")).toBe(true);
    expect(res.cookies.get(OAUTH_COOKIE)!.value).toBe("");
  });

  it("refuses a callback with no state cookie", async () => {
    const res = await callback({ code: "c", state: "s1" });
    expect(redirectedTo(res)).toBe("/login?error=state");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();
  });

  it("refuses a state from another sign-in", async () => {
    const res = await callback({ code: "c", state: "other" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=state");
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();
  });

  it("reports a sign-in Cognito cancelled", async () => {
    const res = await callback({ error: "access_denied", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=denied");
  });

  it("refuses anyone but the owner", async () => {
    vi.mocked(exchangeCode).mockResolvedValue("idtok");
    vi.mocked(isOwner).mockResolvedValue(false);

    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=not-allowed");
    expect(res.cookies.get(COOKIE_NAME)).toBeUndefined();
  });

  it("reports a failed code exchange", async () => {
    vi.mocked(exchangeCode).mockRejectedValue(new Error("token exchange failed: 400"));
    const res = await callback({ code: "c", state: "s1" }, cookieFor("s1"));
    expect(redirectedTo(res)).toBe("/login?error=failed");
  });
});
```

Run: `cd web && npx vitest run app/api/auth` — Expected: FAIL (no routes).

- [ ] **Step 2: Implement** `web/app/api/auth/login/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeUrl, pkcePair, randomState, safeNext } from "@/lib/cognito";
import { createOAuthState, OAUTH_COOKIE, OAUTH_STATE_MAX_AGE_MS } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const state = randomState();
  const { verifier, challenge } = pkcePair();
  const redirectUri = `${request.nextUrl.origin}/api/auth/callback`;

  const response = NextResponse.redirect(authorizeUrl({ redirectUri, state, challenge }));
  response.cookies.set(OAUTH_COOKIE, createOAuthState({ state, verifier, next }, process.env.COOKIE_SECRET!), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: OAUTH_STATE_MAX_AGE_MS / 1000,
  });
  return response;
}
```

`web/app/api/auth/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, createSessionCookieValue } from "@/lib/auth";
import { exchangeCode, isOwner } from "@/lib/cognito";
import { OAUTH_COOKIE, readOAuthState } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

function toLogin(request: NextRequest, error: string) {
  const response = NextResponse.redirect(new URL(`/login?error=${error}`, request.url));
  response.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = readOAuthState(request.cookies.get(OAUTH_COOKIE)?.value, process.env.COOKIE_SECRET!);

  // The state check comes first: without it, anyone could send the owner's
  // browser a callback carrying the attacker's own code.
  if (!saved || params.get("state") !== saved.state) return toLogin(request, "state");
  if (params.get("error")) return toLogin(request, "denied");

  const code = params.get("code");
  if (!code) return toLogin(request, "failed");

  let idToken: string;
  try {
    idToken = await exchangeCode({
      code,
      verifier: saved.verifier,
      redirectUri: `${request.nextUrl.origin}/api/auth/callback`,
    });
  } catch (err) {
    console.error("auth: code exchange failed", err);
    return toLogin(request, "failed");
  }

  if (!(await isOwner(idToken))) return toLogin(request, "not-allowed");

  const response = NextResponse.redirect(new URL(saved.next, request.url));
  response.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  // Same cookie and attributes the password route set, so proxy.ts is unchanged.
  response.cookies.set(COOKIE_NAME, createSessionCookieValue(process.env.COOKIE_SECRET!), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
```

Run: `cd web && npx vitest run app/api/auth` — Expected: PASS. If the login test's `307` differs (`NextResponse.redirect` defaults to 307), keep the route and fix the test's expectation to what `NextResponse.redirect` returns.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/auth
git commit -m "feat(web): Cognito sign-in and callback routes

Refs #290

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 5: Login page, gate list, password removal

**Files:**
- Modify: `web/app/login/page.tsx:40-154`, `web/app/login/page.test.tsx`
- Modify: `web/lib/route-gate.ts:71`, `web/lib/route-gate.test.ts:19`
- Delete: `web/app/api/login/route.ts`, `web/lib/rate-limit.ts`, `web/lib/rate-limit.test.ts`
- Modify: `web/lib/auth.ts` (delete `checkPassword` and the `createHash` import), `web/lib/auth.test.ts` (delete its `checkPassword` tests)

- [ ] **Step 1: Rewrite the page tests.** In `web/app/login/page.test.tsx`: delete the `submit` helper, the `fetch` stub and `pushMock` assertions, and every test that calls `submit()`. Keep the destination-strip tests unchanged. Add:

```ts
  it("links to the sign-in route, carrying next", () => {
    mockSearch = "next=%2Fkeystatic%3Fpath%3Dposts";
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/auth/login?next=%2Fkeystatic%3Fpath%3Dposts",
    );
  });

  it("sends a visit with no next to the hub", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/auth/login?next=%2Ftools",
    );
  });

  it("does not carry an off-site next into the link", () => {
    mockSearch = "next=https%3A%2F%2Fevil.example";
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/auth/login?next=%2Ftools",
    );
  });

  it.each([
    ["state", "That sign-in expired or came from another tab. Try again."],
    ["denied", "Sign-in was cancelled."],
    ["not-allowed", "That account can't open these tools."],
    ["failed", "Sign-in failed. Try again."],
  ])("explains error=%s", (code, message) => {
    mockSearch = `error=${code}`;
    render(<LoginPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });
```

Run: `cd web && npx vitest run app/login` — Expected: FAIL (no Sign in link).

- [ ] **Step 2: Rewrite `LoginForm`.** In `web/app/login/page.tsx`, change the imports to drop `useState` and `useRouter` (`import { Suspense } from "react";`, `import { useSearchParams } from "next/navigation";`), keep `FALLBACK` and `parseNext`, and replace the whole `LoginForm` function (lines 40–154) with:

```tsx
const ERRORS: Record<string, string> = {
  state: "That sign-in expired or came from another tab. Try again.",
  denied: "Sign-in was cancelled.",
  "not-allowed": "That account can't open these tools.",
  failed: "Sign-in failed. Try again.",
};

function LoginForm() {
  const searchParams = useSearchParams();
  const next = parseNext(searchParams.get("next"));
  const destination = next ? toolNameFor(next.pathname) : null;
  const error = ERRORS[searchParams.get("error") ?? ""] ?? null;
  const href = `/api/auth/login?next=${encodeURIComponent(next?.full ?? FALLBACK)}`;

  return (
    <>
      {destination ? (
        <div className="mt-[26px] flex items-center gap-3">
          <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
            Continuing to
          </span>
          <svg
            aria-hidden="true"
            width="18"
            height="10"
            viewBox="0 0 18 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-accent"
          >
            <path d="M0 5h16" />
            <path d="M12.5 1.5 16 5l-3.5 3.5" />
          </svg>
          <span className="text-[0.9375rem] font-semibold tracking-tight">
            {destination}
          </span>
        </div>
      ) : null}

      <p className="mt-[18px] max-w-[46ch] text-base leading-relaxed text-muted">
        {destination
          ? "These tools are for the site's owner. Sign in with Google, an email code or a passkey to continue."
          : "These tools are for the site's owner. Sign in with Google, an email code or a passkey, and every tool on this site opens for the session."}
      </p>

      <div className="mt-9 flex flex-col gap-3.5">
        {/* A plain link, not a fetch: the sign-in is a chain of full-page
          * redirects through Cognito and back to /api/auth/callback. */}
        <a
          href={href}
          className="inline-flex min-h-11 w-fit items-center bg-fg px-5 text-sm font-semibold tracking-tight text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
        >
          Sign in
        </a>
        {error && (
          <p role="alert" className="flex items-center gap-2 text-[0.8125rem] text-peak">
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v6" />
              <path d="M12 16.5v.01" />
            </svg>
            {error}
          </p>
        )}
      </div>
    </>
  );
}
```

Also update the `FALLBACK` comment's "a password-first visit" to "a sign-in with no destination".

Run: `cd web && npx vitest run app/login` — Expected: PASS.

- [ ] **Step 3: Gate list and deletions**

- `web/lib/route-gate.ts:71`: `const ALWAYS_ALLOWED_PATHS = ["/login"];`
- `web/lib/route-gate.test.ts`: replace the `["/api/login", false]` row with `["/api/auth/login", false]` and add `["/api/auth/callback", false]`.
- `git rm web/app/api/login/route.ts web/lib/rate-limit.ts web/lib/rate-limit.test.ts`
- `web/lib/auth.ts`: delete `checkPassword` and drop `createHash` from the `crypto` import. `web/lib/auth.test.ts`: delete the `checkPassword` `describe` block and its import.

Run: `cd web && npm test && npm run lint` — Expected: PASS. `grep -rn "checkPassword\|rate-limit\|/api/login\|APP_PASSWORD" web --include=*.ts --include=*.tsx | grep -v node_modules | grep -v .next` shows only `playwright.config.ts` and e2e files (Task 6).

- [ ] **Step 4: Commit**

```bash
git add -A web/app/login web/lib web/app/api
git commit -m "feat(web): sign in through Cognito; remove the shared password

Refs #290

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 6: e2e signs in with a minted session; docs; PR B

**Files:**
- Create: `web/e2e/session.ts`
- Modify: `web/playwright.config.ts` (remove `APP_PASSWORD`; add Cognito env vars)
- Modify: `web/e2e/tools.spec.ts`, `web/e2e/news-desk.spec.ts`, `web/e2e/money-planner.spec.ts`, `web/e2e/resume-admin.spec.ts`, `web/e2e/pages.spec.ts`
- Delete: `web/e2e/login-rate-limit.spec.ts`
- Modify: `.claude/rules/web.md`, `CHANGELOG.md`

- [ ] **Step 1: Helper** `web/e2e/session.ts`:

```ts
import type { Page } from "@playwright/test";
import { COOKIE_NAME, createSessionCookieValue } from "../lib/auth";

// Must match COOKIE_SECRET in playwright.config.ts's webServer env.
const E2E_COOKIE_SECRET = "devsecret";

/** Signs the browser in the way /api/auth/callback would, without Cognito: a
 * session cookie signed with the server's COOKIE_SECRET. */
export async function signIn(page: Page, baseURL: string): Promise<void> {
  await page.context().addCookies([
    {
      name: COOKIE_NAME,
      value: createSessionCookieValue(E2E_COOKIE_SECRET),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
```

- [ ] **Step 2: Config.** In `web/playwright.config.ts`'s `webServer.env`, delete `APP_PASSWORD: "test123",` and add:

```ts
      COGNITO_DOMAIN: "https://login.invalid",
      COGNITO_CLIENT_ID: "e2e",
      COGNITO_USER_POOL_ID: "us-east-1_e2e",
      OWNER_EMAIL: "owner@example.com",
```

- [ ] **Step 3: Specs.** `git rm web/e2e/login-rate-limit.spec.ts`. In every other spec, each password login:

```ts
  await page.goto("/login");          // or "/login?next=…"
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/…/);
```

becomes a `signIn` before navigating straight to the destination the test was testing:

```ts
  await signIn(page, baseURL!);
  await page.goto("/tools/news-desk");   // the page the old login redirected to
```

with `import { signIn } from "./session";` and `baseURL` added to the test's fixture destructuring (`async ({ page, baseURL }) =>`). Tests whose subject *was* the password form change subject:
- `tools.spec.ts` "a password-first login lands on the hub, not on a tool" → "the sign-in link from a bare /login targets the hub": `await page.goto("/login"); await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/api/auth/login?next=%2Ftools");`
- `tools.spec.ts` login with `next=%2Ftools` → same assertion with the `next` it passed.
- `pages.spec.ts:55` "the command bar opens on the gate, even from the password field" → focus the Sign in link instead of the password field (`await page.getByRole("link", { name: "Sign in" }).focus();`), keep the rest.
- `pages.spec.ts:54` comment: "password box" → "Sign in link".

Keep every "is behind the gate" / "redirects to /login?next=…" assertion unchanged.

Add one spec to `tools.spec.ts`:

```ts
test("the sign-in route sends the browser to Cognito with PKCE", async ({ request }) => {
  const res = await request.get("/api/auth/login?next=%2Ftools", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const location = new URL(res.headers()["location"]);
  expect(location.origin).toBe("https://login.invalid");
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
});
```

Run: `cd web && npm run test:e2e` — Expected: PASS. `grep -rn "password\|test123" web/e2e` returns nothing.

- [ ] **Step 4: Docs.** In `.claude/rules/web.md`:
  - Replace the bullet starting "Auth is a single shared password, not per-user:" with: "Sign-in is owner-only through Cognito managed login (Google, email code, passkey): `/api/auth/login` stores state and a PKCE verifier in the signed `looper_oauth` cookie and redirects to Cognito; `/api/auth/callback` exchanges the code, verifies the ID token with `aws-jwt-verify`, requires `OWNER_EMAIL` with `email_verified`, and sets the session cookie. The session cookie itself is unchanged: its payload is the issue timestamp (ms since epoch) HMAC-signed with `COOKIE_SECRET`, verified against `SESSION_MAX_AGE_MS` (7 days) in `web/lib/auth.ts`. Both `createSessionCookieValue` and `verifySessionCookieValue` take an optional trailing `now` argument. E2E signs in by minting that cookie (`web/e2e/session.ts`)."
  - Delete the bullet starting "`/api/login` is rate-limited by `web/lib/rate-limit.ts`".
  - In the bullet on gated paths, change "require the shared password" to "require a session", and "`ALWAYS_ALLOWED_PATHS` (`/login`, `/api/login`)" to "`ALWAYS_ALLOWED_PATHS` (`/login`)".
  - In the `playwright.config.ts` bullet, change "injects `APP_PASSWORD`/`COOKIE_SECRET`/all three `KEYSTATIC_*`" to "injects `COOKIE_SECRET`, dummy `COGNITO_*`/`OWNER_EMAIL` and all three `KEYSTATIC_*`".
  - In `CLAUDE.md`'s Structure section, "and the Keystatic admin (`/keystatic`, `/api/keystatic/*`)" is unchanged; in Commands, the App dev line becomes `cd web && COOKIE_SECRET=devsecret npm run dev` plus the four Cognito variables, and a note that local sign-in needs the real `COGNITO_*` values (the `localhost:3000` callback is registered).

  `CHANGELOG.md` under `### Changed`:

```markdown
- Signing in to the tools uses Cognito (Google, an email code or a passkey) and only the site owner's account is accepted. The shared password, its login endpoint and its rate limiter are removed (#290).
```

- [ ] **Step 5: Commit and open PR B**

```bash
git add -A web/e2e web/playwright.config.ts .claude/rules/web.md CLAUDE.md CHANGELOG.md
git commit -m "test(e2e): sign in by minting a session; document Cognito sign-in

Refs #290

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/cognito-login
gh pr create --base dev --title "feat: owner sign-in through Cognito" --body "Phase 5, PR B of 3 (spec 2026-09-28-cognito-login-design.md). APP_PASSWORD stays set in Vercel until PR C, so stage and main keep working until promotion.

Refs #290"
```

- [ ] **Step 6: Verify on dev** after merge and deploy:
  1. `https://dev.ashutosh-pandey.com/tools` → `/login?next=/tools` → Sign in → Cognito → Continue with Google (owner) → back on `/tools`.
  2. Clear cookies; sign in with the owner's email and an emailed code.
  3. After signing in, Cognito offers to add a passkey (or visit the authorize URL again and choose passkey); register one, clear cookies, sign in with it.
  4. Sign in with a different Google account → `/login?error=not-allowed` and the message shows; `/tools` still redirects to `/login`.

Repeat 1 on stage and main after each promotion.

---

## PR C — Remove `APP_PASSWORD`

### Task 7: Terraform and docs drop the password

**Files:**
- Modify: `infra/main/shared.tf`, `infra/main/variables.tf`, `infra/main/terraform.tfvars.example`, `CLAUDE.md`, `CHANGELOG.md`

- [ ] **Step 1: Confirm PR B is on main:** `curl -s -o /dev/null -w "%{http_code}" "https://ashutosh-pandey.com/api/auth/login?next=%2Ftools"` returns `307`.

- [ ] **Step 2: Edit**
  - `infra/main/shared.tf`: delete `resource "vercel_project_environment_variable" "app_password"`; in the two comments that say the tools are "protected by APP_PASSWORD" / "stay behind APP_PASSWORD", say "behind the Cognito sign-in" instead.
  - `infra/main/variables.tf`: delete `variable "app_password"`.
  - `infra/main/terraform.tfvars.example`: delete the `app_password` lines and change "until all seven are set" to "until all six are set".
  - `CLAUDE.md`: "**seven required variables** … `vercel_api_token`, `app_password`, `github_repo`, …" becomes "**six required variables** … `vercel_api_token`, `github_repo`, `alert_email`, `openrouter_api_key`, `google_client_id`, `google_client_secret`".
  - Remove `app_password = …` from the local `infra/main/terraform.tfvars` too, or Terraform warns about an undeclared variable.

- [ ] **Step 3: Plan**

Run: `cd infra/main && terraform plan -var-file=terraform.tfvars`
Expected: destroys exactly `vercel_project_environment_variable.app_password`. Nothing else.

- [ ] **Step 4: CHANGELOG** under `### Removed`:

```markdown
- The `APP_PASSWORD` Vercel variable and the `app_password` Terraform variable (#290).
```

- [ ] **Step 5: Commit, PR, apply, merge**

```bash
git add infra/main/shared.tf infra/main/variables.tf infra/main/terraform.tfvars.example CLAUDE.md CHANGELOG.md
git commit -m "chore(infra): remove APP_PASSWORD

Closes #290

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin chore/remove-app-password
gh pr create --base dev --title "chore(infra): remove APP_PASSWORD" --body "Phase 5, PR C of 3. Cognito sign-in is on production (307 from /api/auth/login). Paste the plan summary here.

Closes #290"
```

Apply with the owner's go-ahead before merging, then `No changes.`. Merge per `merging-a-pr`, then tick Phase 5 and close epic #285 once every phase is ticked.
