import { test, expect } from "@playwright/test";

// Both tests here depend on the limiter's in-memory module state, so every login
// test belongs in this one file — a sibling file hitting /api/login could run in
// a parallel worker against the same server and spend the same budget. Within
// the file the two tests are isolated from each other by using different
// X-Forwarded-For identities, which land in separate buckets.
//
// Each request sends a rotating X-Forwarded-For prefix with a FIXED last entry,
// mimicking what a proxy produces: the caller can prepend whatever it likes but
// cannot remove the entry the proxy appends. Reading the first entry (as this
// originally did) let a caller mint a fresh bucket per request and bypass the
// limit entirely.
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

test("signing in correctly never spends the attempt budget", async ({ request }) => {
  // The limiter is checked before the password, so the cap applies to guesses
  // rather than to error responses. A correct password refunds the window —
  // without that, six legitimate logins in 15 minutes (several devices behind
  // one NAT, a cookie expiring, a tab reloaded) would lock the owner out of
  // their own site with the right password in hand.
  const attempt = () =>
    request.post("/api/login", {
      data: { password: "test123" },
      headers: { "x-forwarded-for": "203.0.113.42" },
    });

  for (let i = 0; i < 8; i++) {
    expect((await attempt()).status()).toBe(200);
  }
});
