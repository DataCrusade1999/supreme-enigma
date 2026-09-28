import { test, expect } from "@playwright/test";
import { signIn } from "./session";

test("the News Desk is gated, reachable from the hub, and renders without storage", async ({ page, baseURL }) => {
  await page.goto("/tools/news-desk");
  await expect(page).toHaveURL(/\/login\?next=\/tools\/news-desk/);

  await signIn(page, baseURL!);
  await page.goto("/tools/news-desk");
  await expect(page).toHaveURL(/\/tools\/news-desk$/);

  await expect(page.getByRole("heading", { level: 1, name: "News Desk" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("the refresh route is behind the gate", async ({ request }) => {
  const res = await request.post("/api/news-desk/refresh", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
});

test("the ask and pin routes are behind the gate", async ({ request }) => {
  for (const [method, url] of [
    ["post", "/api/news-desk/ask"],
    ["post", "/api/news-desk/indicators"],
    ["delete", "/api/news-desk/indicators/pin-000000000000"],
  ] as const) {
    const res = await request[method](url, { maxRedirects: 0 });
    expect(res.status(), `${method} ${url}`).toBe(401);
  }
});

test("the chat panel opens and closes", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/tools/news-desk");
  await page.getByRole("button", { name: "Ask MoSPI" }).click();
  await expect(page.getByRole("textbox", { name: "Question" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("textbox", { name: "Question" })).toBeHidden();
});

test("the News Desk fits a phone screen without scrolling sideways", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, baseURL!);
  await page.goto("/tools/news-desk");
  await expect(page.getByRole("heading", { level: 1, name: "News Desk" })).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});

test("the indicator panel starts no higher than its column on desktop", async ({ page, baseURL }) => {
  // With few headlines the grid row is only as tall as the panel, so a centring
  // transform would lift the panel over the refresh bar above it.
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, baseURL!);
  await page.goto("/tools/news-desk");
  const panel = page.getByText("Indicators load on the next Refresh.");
  await expect(panel).toBeVisible();

  const panelTop = (await panel.boundingBox())!.y;
  const refreshBottom = await page
    .getByRole("button", { name: "Refresh" })
    .evaluate((b) => b.parentElement!.getBoundingClientRect().bottom);
  const columnTop = await page.locator("aside").evaluate((a) => a.getBoundingClientRect().top);
  expect(panelTop).toBeGreaterThanOrEqual(columnTop);
  expect(panelTop).toBeGreaterThan(refreshBottom);
});
