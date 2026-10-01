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
