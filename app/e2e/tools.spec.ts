import { test, expect } from "@playwright/test";

test("the tools hub is behind the login gate", async ({ page }) => {
  await page.goto("/tools");
  await expect(page).toHaveURL(/\/login\?next=%2Ftools/);
});

test("a password-first login lands on the hub, not on a tool", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();

  await expect(page).toHaveURL(/\/tools$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
});

test("the hub links to every gated tool", async ({ page }) => {
  await page.goto("/login?next=%2Ftools");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/tools$/);

  for (const [name, href] of [
    ["BGM Looper", "/tools/bgm-looper"],
    ["Resume admin", "/tools/resume-admin"],
    ["Content editor", "/keystatic"],
  ]) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveAttribute(
      "href",
      href,
    );
  }
});

test("the resume admin is reachable from the hub without typing a URL", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/tools$/);

  await page.getByRole("link", { name: /Resume admin/ }).click();
  await expect(page).toHaveURL(/\/tools\/resume-admin/);
  await expect(page.getByRole("heading", { name: "Publish a resume" })).toBeVisible();
});

test("the command bar reaches the gated tools that have no link", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/tools$/);

  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Command bar" }).waitFor();
  await page.getByRole("textbox", { name: "Command" }).fill("open resume-admin");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/tools\/resume-admin/);
});
