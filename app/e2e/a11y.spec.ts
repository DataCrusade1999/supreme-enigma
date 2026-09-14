import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PATHS = [
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
];

for (const path of PATHS) {
  test(`${path} has no automatically detectable accessibility violations`, async ({
    page,
  }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
