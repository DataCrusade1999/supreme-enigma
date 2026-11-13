// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("./authorizer", () => ({ getAuthorizer: vi.fn() }));
vi.mock("./grants", () => ({ getGrantStore: vi.fn() }));

import { cookies } from "next/headers";
import { getAuthorizer } from "./authorizer";
import { getGrantStore } from "./grants";
import { ID_COOKIE, seal } from "../auth";
import { visibleTools } from "./visible-tools";

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const isAuthorized = vi.fn();
const list = vi.fn();
const NOW_S = Math.floor(Date.now() / 1000);

function withCookie(value?: string) {
  vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (n === ID_COOKIE && value ? { value } : undefined) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COOKIE_SECRET = "secret";
  vi.mocked(getAuthorizer).mockReturnValue({ isAuthorized });
  vi.mocked(getGrantStore).mockReturnValue({ list } as never);
  list.mockResolvedValue([]);
});

describe("visibleTools", () => {
  it("keeps the tools whose page action is allowed, in TOOLS order", async () => {
    withCookie(seal(jwt({ sub: "u", exp: 9e9, "cognito:groups": ["friends"] }), "secret"));
    isAuthorized.mockImplementation(async ({ tool }) => (["bgm-looper", "news-desk"].includes(tool) ? "allow" : "deny"));
    expect((await visibleTools()).map((t) => t.id)).toEqual(["bgm-looper", "news-desk"]);
    expect(isAuthorized).toHaveBeenCalledWith(expect.objectContaining({ tool: "keystatic", action: "keystatic:use" }));
  });

  it("hides a tool whose check throws rather than failing the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    withCookie(seal(jwt({ sub: "u", exp: 9e9, "cognito:groups": ["owner"] }), "secret"));
    isAuthorized.mockImplementation(async ({ tool }) => {
      if (tool === "keystatic") throw new Error("timeout");
      return "allow";
    });
    expect((await visibleTools()).map((t) => t.id)).not.toContain("keystatic");
  });

  it("passes each grantable tool the member's access from one grants read", async () => {
    withCookie(seal(jwt({ sub: "u", exp: 9e9, "cognito:groups": ["friends"] }), "secret"));
    list.mockResolvedValue([{ sub: "u", action: "moneyplanner:use", email: "", expiresAt: NOW_S + 600, grantedAt: 0 }]);
    isAuthorized.mockResolvedValue("deny");
    await visibleTools();
    expect(list).toHaveBeenCalledTimes(1);
    const contextOf = (tool: string) => isAuthorized.mock.calls.find(([a]) => a.tool === tool)![0].context;
    expect(contextOf("money-planner").access).toEqual({ expiresAt: NOW_S + 600 });
    expect(contextOf("news-desk").access).toBeUndefined();
    expect(contextOf("resume-admin").access).toBeUndefined();
  });

  it("still checks every tool, without access, when the grants cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    withCookie(seal(jwt({ sub: "u", exp: 9e9, "cognito:groups": ["friends"] }), "secret"));
    list.mockRejectedValue(new Error("throttled"));
    isAuthorized.mockResolvedValue("deny");
    expect(await visibleTools()).toEqual([]);
    expect(isAuthorized).toHaveBeenCalledTimes(7);
  });

  it("does not read grants for the owner", async () => {
    withCookie(seal(jwt({ sub: "u", exp: 9e9, "cognito:groups": ["owner"] }), "secret"));
    isAuthorized.mockResolvedValue("allow");
    await visibleTools();
    expect(list).not.toHaveBeenCalled();
  });

  it("is empty without a session", async () => {
    withCookie(undefined);
    expect(await visibleTools()).toEqual([]);
    expect(isAuthorized).not.toHaveBeenCalled();
  });
});
