import { createHash, randomBytes } from "node:crypto";
import { THEME_INIT_SCRIPT } from "./theme-script";

// The site-wide policy in next.config.mjs has no script-src, because a nonce
// makes a page dynamic and the public pages are static. The /tools pages are
// dynamic already and hold the sessions worth stealing, so the proxy gives them
// this stricter policy (#385). Keep the other directives in step with next.config.mjs.
const THEME_SCRIPT_HASH = createHash("sha256").update(THEME_INIT_SCRIPT).digest("base64");

export const newNonce = () => randomBytes(16).toString("base64");

/** The CSP for a /tools page. Next.js finds the nonce in the request's copy of
 * this header and puts it on its own scripts; 'strict-dynamic' then trusts the
 * scripts those load (Vercel Analytics and Speed Insights). The root layout's
 * inline theme script has no nonce, so it is allowed by hash. */
export function toolsCsp(nonce: string): string {
  // React's dev build uses eval for its error overlay.
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return [
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'sha256-${THEME_SCRIPT_HASH}'${devEval}`,
  ].join("; ");
}

export const isToolsPage = (pathname: string) => pathname === "/tools" || pathname.startsWith("/tools/");
