import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  reporter: [["list"], ["json", { outputFile: "playwright-results.json" }]],
  use: {
    baseURL: "http://localhost:3100",
  },
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      COGNITO_DOMAIN: "https://login.invalid",
      COGNITO_CLIENT_ID: "e2e",
      COGNITO_USER_POOL_ID: "us-east-1_e2e",
      OWNER_EMAIL: "owner@example.com",
      COOKIE_SECRET: "devsecret",
      // `next build` hard-fails without all three of these while collecting
      // page data for /api/keystatic/[...params] — dummy values are enough,
      // real ones are only needed to authenticate against GitHub.
      KEYSTATIC_GITHUB_CLIENT_ID: "dummy",
      KEYSTATIC_GITHUB_CLIENT_SECRET: "dummy",
      KEYSTATIC_SECRET: "dummy",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
