import { test, expect } from "@playwright/test";

test("the resume page is public and renders a timeline", async ({ page }) => {
  await page.goto("/resume");
  await expect(page).toHaveURL(/\/resume$/);
  await expect(page.getByRole("heading", { name: "Resume" })).toBeVisible();
  await expect(page.getByRole("listitem").first()).toBeVisible();
});

test("the resume page shows a skills section", async ({ page }) => {
  await page.goto("/resume");
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
});

test("the about page is public and renders", async ({ page }) => {
  await page.goto("/about");
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
});

test("/resume.pdf answers rather than hanging or 500ing", async ({ request }) => {
  // In CI no resume is published and RESUME_BUCKET_NAME may be unset, so 404
  // is the expected answer. What matters is that the route exists and does
  // not throw — a 500 here is a real failure.
  const res = await request.get("/resume.pdf", { maxRedirects: 0 });
  expect([307, 404]).toContain(res.status());
});
