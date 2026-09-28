import { test, expect } from "@playwright/test";

test("the resume admin page is behind the login gate", async ({ page }) => {
  await page.goto("/tools/resume-admin");
  await expect(page).toHaveURL(/\/login\?next=\/tools\/resume-admin/);
});

test("the gate names the resume admin as the destination", async ({ page }) => {
  await page.goto("/tools/resume-admin");
  await expect(page.getByText("Resume admin")).toBeVisible();
});

test("the resume API returns 401 rather than a redirect", async ({ request }) => {
  // proxy.ts returns a JSON 401 for /api/*, so a fetch from the page gets a
  // parseable error instead of the login page's HTML.
  const res = await request.post("/api/resume/extract", { data: { draftId: "abc" } });
  expect(res.status()).toBe(401);
});

test("signed in, the admin page offers a PDF picker", async ({ page }) => {
  await page.goto("/login?next=%2Ftools%2Fresume-admin");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();

  await expect(page).toHaveURL(/\/tools\/resume-admin/);
  await expect(page.locator('input[type="file"]')).toHaveAttribute(
    "accept",
    "application/pdf",
  );
});
