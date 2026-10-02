// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("./lib/cognito", () => ({ refreshIdToken: vi.fn(), verifyIdToken: vi.fn() }));
vi.mock("./lib/authz/authorizer", () => ({ getAuthorizer: vi.fn() }));

import { refreshIdToken, verifyIdToken } from "./lib/cognito";
import { getAuthorizer } from "./lib/authz/authorizer";
import { ID_COOKIE, REFRESH_COOKIE, seal, unseal } from "./lib/auth";
import { proxy } from "./proxy";

const SECRET = "secret";
const NOW_S = Math.floor(Date.now() / 1000);
const isAuthorized = vi.fn();

const jwt = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const token = (groups: string[] | null, exp = NOW_S + 900) =>
  jwt({ sub: "u1", exp, ...(groups ? { "cognito:groups": groups } : {}) });

function request(path: string, opts: { method?: string; idToken?: string; refreshToken?: string } = {}) {
  const req = new NextRequest(new URL(`https://site.example${path}`), { method: opts.method ?? "GET" });
  if (opts.idToken) req.cookies.set(ID_COOKIE, seal(opts.idToken, SECRET));
  if (opts.refreshToken) req.cookies.set(REFRESH_COOKIE, seal(opts.refreshToken, SECRET));
  return req;
}

const location = (res: Response) => {
  const url = new URL(res.headers.get("location")!);
  return url.pathname + url.search;
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COOKIE_SECRET = SECRET;
  vi.mocked(getAuthorizer).mockReturnValue({ isAuthorized });
  isAuthorized.mockResolvedValue("allow");
});

describe("proxy: ungated and unauthenticated", () => {
  it("passes an ungated path through without deciding anything", async () => {
    const res = await proxy(request("/about"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(isAuthorized).not.toHaveBeenCalled();
  });

  it("redirects a page request without a session to /login with ?next", async () => {
    expect(location(await proxy(request("/tools/news-desk")))).toBe("/login?next=/tools/news-desk");
  });

  it("keeps / legible in ?next but still escapes query and hash characters", async () => {
    const res = await proxy(request("/tools/a%3Fb%23c%26d"));
    const url = new URL(res.headers.get("location")!);
    expect(url.search).toBe("?next=/tools/a%253Fb%2523c%2526d");
  });

  it("answers an API request without a session with 401", async () => {
    const res = await proxy(request("/api/news-desk/ask", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("proxy: decisions", () => {
  it("lets an allowed request through, passing tool, action and the time", async () => {
    const res = await proxy(request("/tools/news-desk", { idToken: token(["friends"]) }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(isAuthorized).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "news-desk", action: "view", context: { now: expect.any(Number) } }),
    );
  });

  it.each([[null], [["us-east-1_x_Google"]]])("sends a user in neither group (%j) to /access-requested", async (groups) => {
    const res = await proxy(request("/tools", { idToken: token(groups) }));
    expect(location(res)).toBe("/access-requested");
    expect(isAuthorized).not.toHaveBeenCalled();
  });

  it("answers the same user's API call with 403 no_access", async () => {
    const res = await proxy(request("/api/news-desk/ask", { method: "POST", idToken: token(null) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no_access" });
  });

  it("denies a gated path with no ROUTE_ACTIONS row without asking", async () => {
    const res = await proxy(request("/tools/news-desk", { method: "POST", idToken: token(["owner"]) }));
    expect(location(res)).toBe("/access-denied?reason=forbidden");
    expect(isAuthorized).not.toHaveBeenCalled();
  });

  it("sends a denied page to /access-denied naming the tool and action", async () => {
    isAuthorized.mockResolvedValue("deny");
    const res = await proxy(request("/tools/resume-admin", { idToken: token(["friends"]) }));
    expect(location(res)).toBe("/access-denied?reason=forbidden&tool=resume-admin&action=view");
  });

  it("answers a denied metered API call with 403 no_grant", async () => {
    isAuthorized.mockResolvedValue("deny");
    const res = await proxy(request("/api/news-desk/ask", { method: "POST", idToken: token(["friends"]) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no_grant" });
  });

  it("answers a denied non-metered API call with 403 forbidden", async () => {
    isAuthorized.mockResolvedValue("deny");
    const res = await proxy(request("/api/resume/publish", { method: "POST", idToken: token(["friends"]) }));
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("fails closed with 503 when the authorizer throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    isAuthorized.mockRejectedValue(new Error("timeout"));
    const res = await proxy(request("/api/news-desk/ask", { method: "POST", idToken: token(["owner"]) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "authorization_unavailable" });
  });

  it("fails closed on a page too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    isAuthorized.mockRejectedValue(new Error("timeout"));
    const res = await proxy(request("/tools", { idToken: token(["owner"]) }));
    expect(location(res)).toBe("/access-denied?reason=authorization_unavailable&tool=hub&action=view");
  });
});

describe("proxy: refresh", () => {
  it("refreshes a token about to expire, decides with the new one, and hands it to the page", async () => {
    const fresh = token(["friends"], NOW_S + 900);
    vi.mocked(refreshIdToken).mockResolvedValue(fresh);
    vi.mocked(verifyIdToken).mockResolvedValue(true);

    const res = await proxy(request("/tools", { idToken: token(["friends"], NOW_S + 30), refreshToken: "rt" }));

    expect(refreshIdToken).toHaveBeenCalledWith("rt");
    expect(isAuthorized).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ idToken: fresh }) }));
    expect(unseal(res.cookies.get(ID_COOKIE)!.value, SECRET)).toBe(fresh);
    // The page runs after the proxy and reads cookies() from the request, so the
    // request's cookie header has to carry the new token too.
    expect(res.headers.get("x-middleware-override-headers")).toContain("cookie");
    expect(res.headers.get("x-middleware-request-cookie")).toContain(`${ID_COOKIE}=`);
  });

  it("leaves a token with time left alone", async () => {
    await proxy(request("/tools", { idToken: token(["friends"], NOW_S + 600), refreshToken: "rt" }));
    expect(refreshIdToken).not.toHaveBeenCalled();
  });

  it.each([
    ["the refresh call fails", () => vi.mocked(refreshIdToken).mockRejectedValue(new Error("400"))],
    ["the new token fails verification", () => {
      vi.mocked(refreshIdToken).mockResolvedValue(token(["friends"]));
      vi.mocked(verifyIdToken).mockResolvedValue(false);
    }],
  ])("signs the user out when %s", async (_label, arrange) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    arrange();
    const res = await proxy(request("/tools/news-desk", { idToken: token(["friends"], NOW_S - 10), refreshToken: "rt" }));
    expect(location(res)).toBe("/login?next=/tools/news-desk");
    expect(res.cookies.get(ID_COOKIE)?.value).toBe("");
    expect(res.cookies.get(REFRESH_COOKIE)?.value).toBe("");
  });

  it("signs out an expired session with no refresh cookie, with 401 for an API", async () => {
    const res = await proxy(request("/api/news-desk/ask", { method: "POST", idToken: token(["friends"], NOW_S - 10) }));
    expect(res.status).toBe(401);
    expect(res.cookies.get(ID_COOKIE)?.value).toBe("");
  });
});
