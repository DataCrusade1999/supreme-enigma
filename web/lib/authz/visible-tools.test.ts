// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("./authorizer", () => ({ getAuthorizer: vi.fn() }));

import { cookies } from "next/headers";
import { getAuthorizer } from "./authorizer";
import { ID_COOKIE, seal } from "../auth";
import { visibleTools } from "./visible-tools";

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const isAuthorized = vi.fn();

function withCookie(value?: string) {
  vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (n === ID_COOKIE && value ? { value } : undefined) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COOKIE_SECRET = "secret";
  vi.mocked(getAuthorizer).mockReturnValue({ isAuthorized });
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

  it("is empty without a session", async () => {
    withCookie(undefined);
    expect(await visibleTools()).toEqual([]);
    expect(isAuthorized).not.toHaveBeenCalled();
  });
});
