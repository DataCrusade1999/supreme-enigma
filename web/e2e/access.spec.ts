import { test, expect } from "@playwright/test";
import { signIn } from "./session";

test("a signed-in user in no group is sent to Access requested", async ({ page, baseURL }) => {
  await signIn(page, baseURL!, "pending");
  await page.goto("/tools");
  await expect(page).toHaveURL(/\/access-requested$/);
  await expect(page.getByRole("link", { name: "access@ashutosh-pandey.com" })).toBeVisible();
});

test("a friend's hub lists only the shareable tools", async ({ page, baseURL }) => {
  await signIn(page, baseURL!, "friends");
  await page.goto("/tools");
  for (const name of ["BGM Looper", "Money Planner", "News Desk"]) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  }
  for (const name of ["Resume admin", "Newsletter admin", "Content editor"]) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
  }
});

test("a friend opening an owner-only tool lands on Access denied", async ({ page, baseURL }) => {
  await signIn(page, baseURL!, "friends");
  await page.goto("/tools/resume-admin");
  await expect(page).toHaveURL(/\/access-denied\?reason=forbidden&tool=resume-admin&action=view$/);
  await expect(page.getByText("This account can't open that.")).toBeVisible();
});

test("a friend without a grant can't ask the News Desk assistant", async ({ page, baseURL }) => {
  await signIn(page, baseURL!, "friends");
  const res = await page.request.post("/api/news-desk/ask", { data: { question: "CPI?" } });
  expect(res.status()).toBe(403);
  expect(await res.json()).toEqual({ error: "no_grant" });
});

test("the owner's hub lists every tool", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/tools");
  for (const name of ["BGM Looper", "Resume admin", "Newsletter admin", "Money Planner", "News Desk", "Content editor"]) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  }
});
