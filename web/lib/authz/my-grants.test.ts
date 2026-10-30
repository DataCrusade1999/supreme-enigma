// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("./grants", () => ({ getGrantStore: vi.fn() }));

import { cookies } from "next/headers";
import { getGrantStore, type Grant } from "./grants";
import { ID_COOKIE, seal } from "../auth";
import { describeGrant, myGrants } from "./my-grants";

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const list = vi.fn();
// Far enough ahead that "still usable" doesn't depend on today's date.
const LATER = 4_102_444_800;
const g = (over: Partial<Grant>): Grant => ({ sub: "u", action: "newsdesk:ask", email: "", limit: 20, used: 13, expiresAt: 1_791_504_000, grantedAt: 0, ...over });

function signedInAs(groups: string[]) {
  const value = seal(jwt({ sub: "u", exp: 9e9, "cognito:groups": groups }), "secret");
  vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (n === ID_COOKIE ? { value } : undefined) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COOKIE_SECRET = "secret";
  vi.mocked(getGrantStore).mockReturnValue({ list } as never);
});

describe("myGrants", () => {
  it("returns a friend's grants that are still usable", async () => {
    signedInAs(["friends"]);
    list.mockResolvedValue([
      g({ expiresAt: LATER }),
      g({ action: "looper:process", used: 20, expiresAt: LATER }),
      g({ action: "newsdesk:refresh", expiresAt: 1 }),
    ]);
    expect((await myGrants()).map((x) => x.action)).toEqual(["newsdesk:ask"]);
  });

  it("is empty for the owner, who is never counted", async () => {
    signedInAs(["owner"]);
    expect(await myGrants()).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it("is empty rather than failing the hub when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedInAs(["friends"]);
    list.mockRejectedValue(new Error("throttled"));
    expect(await myGrants()).toEqual([]);
  });
});

describe("describeGrant", () => {
  it("names the action, what is left and the last day", () => {
    expect(describeGrant(g({}))).toBe("News Desk ask: 7 of 20 left, until 9 Oct 2026");
  });
});
