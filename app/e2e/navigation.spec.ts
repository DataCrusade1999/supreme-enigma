import { test, expect } from "@playwright/test";

test("header nav links navigate between pages", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL("/about");
  await expect(
    page.getByRole("heading", { level: 1, name: "About" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL("/projects");
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).toBeVisible();

  // The header's action bar is also a link named "BGM Looper", so the row's
  // link is reached through <main> rather than by name alone.
  await page
    .getByRole("main")
    .getByRole("link", { name: "BGM Looper" })
    .click();
  await expect(page).toHaveURL("/projects/bgm-looper");
  await expect(
    page.getByRole("heading", { level: 1, name: "BGM Looper" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Blog" }).click();
  await expect(page).toHaveURL("/blog");
  await expect(
    page.getByRole("heading", { level: 1, name: "Blog" }),
  ).toBeVisible();
});
