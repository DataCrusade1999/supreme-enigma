import { test, expect } from "@playwright/test";

const PAGES = [
  { path: "/", heading: "Ashutosh Pandey" },
  { path: "/about", heading: "About" },
  { path: "/projects", heading: "Projects" },
  { path: "/projects/bgm-looper", heading: "BGM Looper" },
  { path: "/resume", heading: "Resume" },
  { path: "/contact", heading: "Contact" },
  { path: "/blog", heading: "Blog" },
  { path: "/blog/hello-world", heading: "Hello, World" },
  { path: "/login", heading: "Sign in" },
];

for (const { path, heading } of PAGES) {
  test(`${path} loads and shows its heading`, async ({ page }) => {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
  });
}

// The login page moved out from under the looper. A stale link to the old path
// has to end at the gate with ?next pointing at the tool — not at a 404, and
// not at the tool itself.
test("the old login path redirects to the gate, aimed back at the tool", async ({
  page,
}) => {
  await page.goto("/tools/bgm-looper/login");
  await expect(page).toHaveURL(/\/login\?next=%2Ftools%2Fbgm-looper$/);
  await expect(page.getByText("BGM Looper")).toBeVisible();
});
