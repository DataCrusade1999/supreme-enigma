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
    ["Newsletter admin", "/tools/newsletter-admin"],
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

// The e2e environment has no BUTTONDOWN_API_KEY, so isIssueSent throws and
// every row falls back to "Status unknown". Assert on the heading and the row,
// never on a Send button — that would tie the suite to a live Buttondown account.
test("the newsletter admin is reachable from the hub without typing a URL", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/tools$/);

  await page.getByRole("link", { name: /Newsletter admin/ }).click();
  await expect(page).toHaveURL(/\/tools\/newsletter-admin/);
  await expect(page.getByRole("heading", { name: "Send an issue" })).toBeVisible();
  await expect(page.getByText("Hello, newsletter")).toBeVisible();
});

test("the command bar reaches the gated tools that have no link", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/tools$/);

  // The ⌘K listener is attached in a useEffect after hydration, and a keydown
  // in that gap lands on <body> outside React's root, so it's lost rather than
  // replayed — a single press then waits out the full timeout. Same retry as
  // the gate's command bar test in pages.spec.ts.
  const dialog = page.getByRole("dialog", { name: "Command bar" });
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole("textbox", { name: "Command" }).fill("open resume-admin");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/tools\/resume-admin/);
});

test("the command bar opens the newsletter admin", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/tools$/);

  const dialog = page.getByRole("dialog", { name: "Command bar" });
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole("textbox", { name: "Command" }).fill("open newsletter-admin");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/tools\/newsletter-admin/);
});
