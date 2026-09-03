import { test, expect } from "@playwright/test";

const PAGES = [
  { path: "/", heading: "Ashutosh Pandey" },
  { path: "/about", heading: "About" },
  { path: "/projects", heading: "Projects" },
  { path: "/resume", heading: "Resume" },
  { path: "/contact", heading: "Contact" },
  { path: "/blog", heading: "Blog" },
  { path: "/blog/hello-world", heading: "Hello, World" },
];

for (const { path, heading } of PAGES) {
  test(`${path} loads and shows its heading`, async ({ page }) => {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
  });
}
