import { test, expect } from "@playwright/test";

// This spec is order-dependent on the limiter's in-memory module state, so it must
// be the only test in its file — keep any future login tests consolidated here, or
// a sibling test hitting /api/login will consume the same budget.
test("the login endpoint starts refusing after repeated bad passwords", async ({
  request,
}) => {
  const attempt = () =>
    request.post("/api/login", { data: { password: "definitely-wrong" } });

  // The limiter allows 5 per window; the 6th must be refused.
  for (let i = 0; i < 5; i++) {
    expect((await attempt()).status()).toBe(401);
  }

  const blocked = await attempt();
  expect(blocked.status()).toBe(429);
  expect(blocked.headers()["retry-after"]).toBeTruthy();
});
