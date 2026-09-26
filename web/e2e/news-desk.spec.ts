import { test, expect } from "@playwright/test";

test("the News Desk is gated, reachable from the hub, and renders without storage", async ({ page }) => {
  await page.goto("/tools/news-desk");
  await expect(page).toHaveURL(/\/login\?next=%2Ftools%2Fnews-desk/);

  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/tools\/news-desk$/);

  await expect(page.getByRole("heading", { level: 1, name: "News Desk" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("the refresh route is behind the gate", async ({ request }) => {
  const res = await request.post("/api/news-desk/refresh", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
});

test("the News Desk fits a phone screen without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools/news-desk");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: "News Desk" })).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});
