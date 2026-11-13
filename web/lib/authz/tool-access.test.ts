import { describe, expect, it } from "vitest";
import type { Grant } from "./grants";
import { toolAccess } from "./tool-access";

const NOW = 1_000_000;
const g = (over: Partial<Grant>): Grant => ({ sub: "u", action: "newsdesk:read", email: "", expiresAt: NOW + 100, grantedAt: 0, ...over });

describe("toolAccess", () => {
  it("is undefined with no grants", () => {
    expect(toolAccess([], "news-desk", NOW)).toBeUndefined();
  });

  it("is undefined when the only grant has expired", () => {
    expect(toolAccess([g({ expiresAt: NOW })], "news-desk", NOW)).toBeUndefined();
  });

  it("takes the later expiry of two unexpired grants", () => {
    const grants = [g({ expiresAt: NOW + 50 }), g({ action: "newsdesk:ask", limit: 5, used: 0, expiresAt: NOW + 500 })];
    expect(toolAccess(grants, "news-desk", NOW)).toEqual({ expiresAt: NOW + 500 });
  });

  it("counts a used-up metered grant that has not expired", () => {
    expect(toolAccess([g({ action: "newsdesk:ask", limit: 5, used: 5 })], "news-desk", NOW)).toEqual({ expiresAt: NOW + 100 });
  });

  it("ignores another tool's grant", () => {
    expect(toolAccess([g({ action: "moneyplanner:use" })], "news-desk", NOW)).toBeUndefined();
  });
});
