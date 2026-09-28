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
  { path: "/newsletter", heading: "Newsletter" },
  { path: "/newsletter/hello-newsletter", heading: "Hello, newsletter" },
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

test("the head links an SVG favicon and a PNG apple-touch icon that both serve", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const icon = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute("href");
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");

  const svg = await request.get(icon!);
  expect(svg.ok()).toBe(true);
  expect(svg.headers()["content-type"]).toContain("image/svg+xml");
  // A browser draws nothing for an SVG that isn't well-formed XML, and the
  // PNG below is rendered from the same file.
  const parseError = await page.evaluate(
    (text) =>
      new DOMParser()
        .parseFromString(text, "image/svg+xml")
        .querySelector("parsererror")?.textContent ?? null,
    await svg.text(),
  );
  expect(parseError).toBeNull();

  const png = await request.get(apple!);
  expect(png.ok()).toBe(true);
  expect(png.headers()["content-type"]).toContain("image/png");
});

// The gate has no SiteHeader, so ⌘K is its only nav — including from the
// Sign in link, which is the first thing a visitor reaches there.
test("the command bar opens on the gate, even from the Sign in link", async ({
  page,
}) => {
  await page.goto("/login");
  const dialog = page.getByRole("dialog", { name: "Command bar" });

  // goto can resolve before the ⌘K listener exists — it's attached in a useEffect
  // after hydration, and the keydown lands on <body>, outside React's root, so
  // a press in that gap isn't replayed the way a click on the tree would be.
  // It's simply lost, and a single press then waits out the full timeout on a
  // dialog that can never open. Retry until the listener is there.
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("link", { name: "Sign in" }).focus();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(dialog).toBeVisible();
});

// The login page moved out from under the looper. A stale link to the old path
// has to end at the gate with ?next pointing at the tool — not at a 404, and
// not at the tool itself.
test("the old login path redirects to the gate, aimed back at the tool", async ({
  page,
}) => {
  await page.goto("/tools/bgm-looper/login");
  await expect(page).toHaveURL(/\/login\?next=\/tools\/bgm-looper$/);
  await expect(page.getByText("BGM Looper")).toBeVisible();
});
