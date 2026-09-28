# Cognito login — Design

**Date:** 2026-09-28
**Status:** Approved 2026-09-28. Written without a brainstorming session, at the owner's request; the owner reviewed the §3 decisions afterwards.
**Issue:** #290
**Epic:** #285 (phase 5 of 5). Depends on phase 4 (#289) for the SES domain identity.

## 1. Problem

`/tools`, the gated API routes and `/keystatic` sit behind one shared password (`APP_PASSWORD`). A successful login sets an HMAC-signed session cookie that lasts 7 days. The password protects everything, is typed by hand, and only has an in-memory rate limiter in front of it, which resets per serverless instance. The owner wants a real sign-in and no password.

## 2. Goals and non-goals

Goals:

- **Sign-in.** It goes through Cognito managed login, with three ways in:
  - Google
  - an email one-time code
  - a passkey, registered after the first sign-in
- **Owner only.** Only the owner's email address gets a session. Any other Google account is refused after Cognito, by the app.
- **The session stays.** The existing `looper_session` cookie and `proxy.ts` are unchanged. Cognito replaces the password check, not the session.
- **Removal.** `APP_PASSWORD`, `/api/login`, `checkPassword`, `lib/rate-limit.ts` and the rate-limit e2e spec are removed.

Non-goals:

- GitHub sign-in. Cognito has no built-in GitHub provider, and GitHub OAuth isn't OpenID Connect, so it would need an OIDC wrapper service. Google plus passkey plus email code covers the owner.
- A logout button. There's none today, and the session still expires after 7 days.
- A custom domain for the Cognito login page (`auth.ashutosh-pandey.com`). It would need an ACM certificate and DNS records, and it makes no difference to one user. The prefix domain `ashutosh-pandey-login.auth.us-east-1.amazoncognito.com` is used instead.
- Sign-in on the `*.vercel.app` URLs. Only the four registered callback hosts work: the apex, `dev.`, `stage.` and `localhost:3000`.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Integration | Hand-written OAuth 2.0 authorization code + PKCE, in two route handlers, with `aws-jwt-verify` to check the ID token | About 150 lines. Amplify or NextAuth would replace the session model the proxy relies on. This is also the flow worth learning. |
| Client type | Public client, no secret, PKCE required | Nothing to leak. PKCE covers the code-interception risk a secret would cover. |
| Feature plan | Essentials | Managed login, passkeys and email codes need it. Free up to 10,000 monthly active users, and this has one. |
| First factors | `PASSWORD`, `EMAIL_OTP`, `WEB_AUTHN` | The owner user gets a random 32-character password that nobody knows. It exists so the user is `CONFIRMED` and so the policy is accepted in case AWS requires `PASSWORD` in the list. |
| Cognito's email | `DEVELOPER` mode through phase 4's SES domain identity, from `no-reply@ashutosh-pandey.com` | Email codes need SES. The owner's address is already verified in SES, so the sandbox is enough. |
| Owner check | ID token `email` equals `OWNER_EMAIL` (case-insensitive) and `email_verified` is true | Google sign-in creates a Cognito user for any Google account. The app is the only gate for those. |
| State and PKCE storage | One signed, short-lived cookie (`looper_oauth`, 10 min, path `/api/auth`) holding `{state, verifier, next}` | No server storage. Signed with `COOKIE_SECRET`, like the session. |
| Rollout | Infra first. Then the web switch. Then remove `APP_PASSWORD` once the switch is on main. | Removing the Vercel env var earlier would break password login on stage and main. |

## 4. Flow

1. The proxy redirects an unauthenticated request to `/login?next=/tools/x`, as now.
2. `/login` shows a **Sign in** link to `/api/auth/login?next=/tools/x`.
3. `GET /api/auth/login`:
   - cleans up `next`: a relative path not starting `//`, otherwise `/tools`
   - creates a `state` and a PKCE verifier/challenge pair
   - sets `looper_oauth`
   - redirects to `<COGNITO_DOMAIN>/oauth2/authorize` with `response_type=code`, `client_id`, `redirect_uri=<origin>/api/auth/callback`, `scope=openid email`, `state`, `code_challenge`, `code_challenge_method=S256`
4. Cognito managed login: Google, email code or passkey.
5. `GET /api/auth/callback?code&state`:
   - reads and verifies `looper_oauth`, and compares `state`
   - posts the code and verifier to `/oauth2/token`
   - verifies the ID token (signature, issuer, audience, `token_use=id`, expiry)
   - checks it's the owner
   - sets `looper_session`, clears `looper_oauth`, and redirects to `next`
6. Failures redirect to `/login?error=<state|denied|not-allowed|failed>`, and the page shows a matching message.

## 5. Infrastructure

Everything is in `infra/main/auth.tf` and shared by all environments, like `COOKIE_SECRET`.

- `aws_cognito_user_pool.owner`:
  - Essentials, email as the username, admin-created users only
  - no deletion protection, so the kill-switch `terraform destroy` of `infra/main` still works
  - the sign-in policy above
  - WebAuthn with the relying party set to the Cognito domain
  - SES developer email
- `aws_sesv2_email_identity_policy` allowing `cognito-idp.amazonaws.com` to send as the domain, for this user pool only.
- `aws_cognito_user_pool_domain` `ashutosh-pandey-login`, with `managed_login_version = 2`.
- `aws_cognito_managed_login_branding` with Cognito's default look. Managed login v2 pages need a branding style assigned to the client.
- `aws_cognito_identity_provider` Google:
  - `openid email profile`
  - maps `email` and `email_verified`
  - client ID and secret from two new required variables, `google_client_id` and `google_client_secret`
  - the Google OAuth client itself is created by hand in Google Cloud Console, with the redirect URI `https://ashutosh-pandey-login.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
- `aws_cognito_user_pool_client` `web`:
  - public, code flow, scopes `openid email`
  - callback URLs for the four hosts
  - identity providers `COGNITO` and `Google`
  - `ALLOW_USER_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`
- `aws_cognito_user` for the owner: `email_verified = true`, a random password, no invitation email.
- Vercel env vars for production and preview: `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID`, `COGNITO_USER_POOL_ID`, `OWNER_EMAIL`.
- In the last PR: remove `var.app_password` and the `APP_PASSWORD` env var.

The required variables go from five to seven with the Google pair, then to six once `app_password` is removed. `CLAUDE.md` and `terraform.tfvars.example` change with each step.

## 6. Web

- `lib/oauth-state.ts`: `createOAuthState(payload, secret, now)` and `readOAuthState(value, secret, now)`. It uses the same HMAC as the session and a 10-minute lifetime.
- `lib/cognito.ts`:
  - `pkcePair()`
  - `authorizeUrl(...)`
  - `exchangeCode(...)` (uses `fetch`)
  - `isOwner(idToken, verifier?)`, using `aws-jwt-verify`'s `CognitoJwtVerifier`
  - `safeNext(value)`
- `app/api/auth/login/route.ts` and `app/api/auth/callback/route.ts`.
- `app/login/page.tsx` swaps the password form for a Sign in link and the error messages. The destination strip stays.
- `lib/route-gate.ts`: `ALWAYS_ALLOWED_PATHS` loses `/api/login`. `/api/auth/*` isn't under a gated prefix.
- Removed:
  - `app/api/login/route.ts`
  - `checkPassword` and its tests
  - `lib/rate-limit.ts` and its test
  - `e2e/login-rate-limit.spec.ts`
  - `APP_PASSWORD` from `playwright.config.ts`
- The e2e specs that logged in with the password use a helper that sets a session cookie signed with the e2e `COOKIE_SECRET`.

## 7. Testing

- **Vitest:**
  - OAuth state: round trip, tampering, expiry, a malformed value
  - PKCE: the challenge is `base64url(sha256(verifier))`
  - authorize URL parameters
  - code exchange: the request body, and an error when the response isn't OK
  - owner check: a match, a different email, a case difference, unverified email as `false` or `"false"`, and a verifier that throws
  - `safeNext`: `//evil`, `https://evil` and `/\evil` are all rejected
  - login route: the redirect and the cookie
  - callback route:
    - success
    - state mismatch
    - missing cookie
    - Cognito `error` parameter
    - not the owner (no session cookie)
    - exchange failure
  - login page: the link carries `next`, and each error message shows
- **Playwright:** the gate still redirects to `/login?next=…`, and `/login` shows the Sign in link. Each gated spec uses the cookie helper.
- **Manual, on dev:**
  - sign in with Google
  - sign in with an email code
  - register a passkey, then sign in with it
  - sign in with a second Google account and get `not-allowed`

## 8. Cost

- Cognito Essentials: one monthly active user, inside the free tier.
- Email codes through SES: $0.10 per 1,000.
- Effectively $0.
