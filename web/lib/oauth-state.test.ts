import { describe, expect, it } from "vitest";
import { createOAuthState, OAUTH_STATE_MAX_AGE_MS, readOAuthState } from "./oauth-state";

const SECRET = "test-secret";
const PAYLOAD = { state: "s1", verifier: "v1", next: "/tools/news-desk" };

describe("oauth state cookie", () => {
  it("round-trips", () => {
    const value = createOAuthState(PAYLOAD, SECRET, 1_000);
    expect(readOAuthState(value, SECRET, 2_000)).toEqual(PAYLOAD);
  });

  it("rejects a value signed with another secret", () => {
    expect(readOAuthState(createOAuthState(PAYLOAD, "other", 1_000), SECRET, 2_000)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [, sig] = createOAuthState(PAYLOAD, SECRET, 1_000).split(".");
    const forged = Buffer.from(JSON.stringify({ ...PAYLOAD, next: "//evil", issuedAt: 1_000 })).toString("base64url");
    expect(readOAuthState(`${forged}.${sig}`, SECRET, 2_000)).toBeNull();
  });

  it("expires after ten minutes", () => {
    const value = createOAuthState(PAYLOAD, SECRET, 0);
    expect(readOAuthState(value, SECRET, OAUTH_STATE_MAX_AGE_MS - 1)).toEqual(PAYLOAD);
    expect(readOAuthState(value, SECRET, OAUTH_STATE_MAX_AGE_MS)).toBeNull();
  });

  it.each([undefined, "", "no-dot", "a.b.c", "!!!.deadbeef"])("rejects malformed %s", (value) => {
    expect(readOAuthState(value, SECRET, 0)).toBeNull();
  });
});
