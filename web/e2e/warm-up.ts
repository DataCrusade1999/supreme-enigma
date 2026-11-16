import { chromium, type FullConfig } from "@playwright/test";
import { TOOLS } from "../lib/route-gate";
import { signIn } from "./session";

// Opens every page the specs visit once before any spec runs (#146). The
// server the config starts is reachable, not warm: the first request to each
// route loads its server code and the browser fetches its chunks for the first
// time, and that landed inside whichever spec ran first, sometimes past its
// 30 s timeout. Paying it here leaves every test's own timeout as it was.
const PAGES = [
  "/",
  "/about",
  "/projects",
  "/projects/bgm-looper",
  "/resume",
  "/contact",
  "/blog",
  "/blog/hello-world",
  "/newsletter",
  "/newsletter/hello-newsletter",
  "/login",
  "/tools",
  ...TOOLS.map((t) => t.href).filter((href) => href.startsWith("/tools/")),
];

export default async function warmUp(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0].use.baseURL!;
  const browser = await chromium.launch();
  try {
    const started = Date.now();
    const page = await browser.newPage({ baseURL });
    await signIn(page, baseURL);
    let loaded = 0;
    for (const path of PAGES) {
      // A page that fails here fails again in its own spec, which reports it.
      const res = await page.goto(path, { waitUntil: "load", timeout: 120_000 }).catch(() => null);
      if (res?.ok()) loaded++;
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`warm-up: ${loaded} of ${PAGES.length} pages loaded in ${seconds} s`);
  } finally {
    await browser.close();
  }
}
