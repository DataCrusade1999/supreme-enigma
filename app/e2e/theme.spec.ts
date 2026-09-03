import { test, expect } from "@playwright/test";

test("theme toggle flips the dark class and persists across navigation", async ({
  page,
}) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/);

  // The button names the mode it switches *to*, so it reads "Light mode"
  // while the site is in its default dark mode.
  await page.getByRole("button", { name: "Light mode" }).click();
  await expect(html).not.toHaveClass(/dark/);
  const stored = await page.evaluate(() => localStorage.getItem("theme"));
  expect(stored).toBe("light");

  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL("/about");
  await expect(html).not.toHaveClass(/dark/);
});
