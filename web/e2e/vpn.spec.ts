import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./session";

// The memory store lives for the whole server process and Playwright reuses one server,
// so every test removes the peers it adds and puts the settings back.

async function addPeer(page: Page, name: string) {
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add peer" }).click();
  await expect(page.getByRole("dialog", { name: "New device config" })).toBeVisible();
}

async function closeDialog(page: Page) {
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function removePeer(page: Page, name: string) {
  await page.getByRole("button", { name: `Remove ${name}`, exact: true }).click();
  await page.getByRole("button", { name: `Confirm remove ${name}` }).click();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
}

test("the owner adds a peer and sees its QR and .conf once", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/tools/vpn");
  await addPeer(page, "laptop");

  const dialog = page.getByRole("dialog", { name: "New device config" });
  await expect(dialog.locator("canvas")).toBeVisible();
  const link = dialog.getByRole("link", { name: "Download .conf" });
  await expect(link).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe("laptop.conf");
  const path = await download.path();
  const conf = await readFile(path, "utf8");
  expect(conf).toContain("Address = 10.66.66.2/32");
  expect(conf).toContain("Endpoint = 203.0.113.10:51820");

  await closeDialog(page);
  await expect(page.getByText("laptop", { exact: true })).toBeVisible();
  await removePeer(page, "laptop");
});

test("switching to split tunnel marks the peer out of date, and re-issue clears it", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/tools/vpn");
  await addPeer(page, "phone");
  await closeDialog(page);

  try {
    await page.getByRole("radio", { name: "Split" }).check();
    await page.getByLabel("CIDRs sent through the VPN").fill("192.168.0.0/16");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Out of date — re-issue")).toBeVisible();

    await page.getByRole("button", { name: "Re-issue phone" }).click();
    await expect(page.getByRole("dialog", { name: "New device config" })).toBeVisible();
    await closeDialog(page);
    await expect(page.getByText("Out of date — re-issue")).toHaveCount(0);
  } finally {
    await page.getByRole("radio", { name: "Full" }).check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("button", { name: "Save settings" })).toBeEnabled();
    await removePeer(page, "phone");
  }
});

test("removing a peer takes it off the list", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/tools/vpn");
  await addPeer(page, "tablet");
  await closeDialog(page);
  await expect(page.getByText("tablet", { exact: true })).toBeVisible();

  await removePeer(page, "tablet");
  await expect(page.getByText("No devices yet.")).toBeVisible();
});

test("a friend is sent to Access denied", async ({ page, baseURL }) => {
  await signIn(page, baseURL!, "friends");
  await page.goto("/tools/vpn");
  await expect(page).toHaveURL(/\/access-denied\?reason=forbidden&tool=vpn&action=vpn%3Amanage$/);
});
