import { test, expect } from "@playwright/test";

// This spec is order-dependent on the limiter's in-memory module state, so it must
// be the only test in its file — keep any future login tests consolidated here, or
// a sibling test hitting /api/login will consume the same budget.
//
// Every request below sends a rotating X-Forwarded-For prefix with a FIXED last
// entry, mimicking what a proxy produces: the caller can prepend whatever it
// likes but cannot remove the entry the proxy appends. Reading the first entry
// (as this originally did) let a caller mint a fresh bucket per request and
// bypass the limit entirely.
test("the login endpoint starts refusing after repeated bad passwords", async ({
  request,
}) => {
  let spoofAttempt = 0;
  const attempt = () =>
    request.post("/api/login", {
      data: { password: "definitely-wrong" },
      headers: { "x-forwarded-for": `10.0.0.${++spoofAttempt}, 203.0.113.7` },
    });

  // The limiter allows 5 per window; the 6th must be refused despite every
  // request claiming a different prepended address.
  for (let i = 0; i < 5; i++) {
    expect((await attempt()).status()).toBe(401);
  }

  const blocked = await attempt();
  expect(blocked.status()).toBe(429);
  expect(blocked.headers()["retry-after"]).toBeTruthy();

  // A genuinely different client still gets its own allowance.
  const other = await request.post("/api/login", {
    data: { password: "definitely-wrong" },
    headers: { "x-forwarded-for": "10.0.0.1, 198.51.100.4" },
  });
  expect(other.status()).toBe(401);
});
