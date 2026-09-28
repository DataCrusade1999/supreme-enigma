import { test, expect } from "@playwright/test";
import { signIn } from "./session";

test("the money planner is reachable from the hub and answers", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/tools");

  await page.getByRole("link", { name: /Money Planner/ }).click();
  await expect(page).toHaveURL(/\/tools\/money-planner/);
  await expect(page.getByRole("heading", { level: 1, name: "Money Planner" })).toBeVisible();

  await page.getByLabel("Balance today").fill("0");
  await page.getByLabel("Monthly salary").fill("80000");
  await page.getByLabel("Pay day").fill("1");
  await page.getByLabel("What are you buying").fill("Camera");
  await page.getByLabel("Price").fill("90000");

  // Two months of salary with nothing going out. Assert on the shape of the
  // answer, not a fixed date — this suite runs on whatever day CI runs it. The
  // pattern excludes the bare word "today", which is also the "Balance today"
  // label and would be a strict-mode violation.
  await expect(page.getByText(/(months?|days?) away/)).toBeVisible();
});

test("the planner remembers a plan across a reload", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto("/tools/money-planner");

  await page.getByLabel("Monthly salary").fill("80000");

  // The input is controlled, so it holds the value immediately — but the save
  // is debounced by 300 ms. Reloading on the input's value alone races the
  // timer and the reload wins. Wait for the write itself.
  await page.waitForFunction(() =>
    (localStorage.getItem("money-planner") ?? "").includes('"salary":80000'),
  );

  await page.reload();
  await expect(page.getByLabel("Monthly salary")).toHaveValue("80000");
});
