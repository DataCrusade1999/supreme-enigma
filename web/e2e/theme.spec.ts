import { test, expect } from "@playwright/test";

test("theme toggle flips the dark class and persists across navigation", async ({
  page,
}) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/);

  // The toggle is an icon button: both SVGs are aria-hidden, so it carries no
  // text and its accessible name comes from `aria-label`, which names the mode
  // the click will produce rather than the current one.
  const toggle = page.getByRole("button", {
    name: "Switch to light mode",
    exact: true,
  });
  await expect(toggle).toHaveText("");
  await toggle.click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(
    page.getByRole("button", { name: "Switch to dark mode", exact: true }),
  ).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem("theme"));
  expect(stored).toBe("light");

  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL("/about");
  await expect(html).not.toHaveClass(/dark/);
});
