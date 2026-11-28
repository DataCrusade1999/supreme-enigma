import { test, expect } from "@playwright/test";
import { signIn } from "./session";

// Every /tools page gets a nonce-based script-src from the proxy (#385). A script
// the policy blocks, Next.js's own or the inline theme script, fires a
// securitypolicyviolation event; none may fire.
const TOOL_PAGES = [
  "/tools",
  "/tools/bgm-looper",
  "/tools/resume-admin",
  "/tools/newsletter-admin",
  "/tools/money-planner",
  "/tools/news-desk",
  "/tools/vpn",
  "/tools/access-admin",
];

for (const path of TOOL_PAGES) {
  test(`${path} enforces a nonce-based script-src with no violations`, async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await page.addInitScript(() => {
      (window as unknown as { cspViolations: string[] }).cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        (window as unknown as { cspViolations: string[] }).cspViolations.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`),
      );
    });

    const res = await page.goto(path);
    expect(res!.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)).toEqual([]);
  });
}
