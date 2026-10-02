import type { Page } from "@playwright/test";
import { ID_COOKIE, seal } from "../lib/auth";

// Must match COOKIE_SECRET in playwright.config.ts's webServer env.
const E2E_COOKIE_SECRET = "devsecret";

export type Role = "owner" | "friends" | "pending";

/** An unsigned token: under AUTHZ_MODE=local the server trusts the claims
 * inside the encrypted cookie and evaluates the real Cedar policies. `exp` is an
 * hour out so the proxy never tries to refresh it. */
function testToken(role: Role): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = {
    sub: `e2e-${role}`,
    email: `${role}@example.com`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...(role === "pending" ? {} : { "cognito:groups": [role] }),
  };
  return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.`;
}

/** Signs the browser in the way /api/auth/callback would, without Cognito. */
export async function signIn(page: Page, baseURL: string, role: Role = "owner"): Promise<void> {
  await page.context().addCookies([
    {
      name: ID_COOKIE,
      value: seal(testToken(role), E2E_COOKIE_SECRET),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
