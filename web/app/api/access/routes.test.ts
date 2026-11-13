// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/access-admin", async (importOriginal) => ({
  AccessError: (await importOriginal<typeof import("@/lib/access-admin")>()).AccessError,
  listUsers: vi.fn(),
  approve: vi.fn(),
  removeMember: vi.fn(),
  dismiss: vi.fn(),
  grantAction: vi.fn(),
  revokeGrant: vi.fn(),
}));
vi.mock("@/lib/access-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access-api")>()),
  actingEmail: vi.fn(async () => "owner@example.com"),
}));
vi.mock("@/lib/access-mail", () => ({ sendApproved: vi.fn(), sendGrants: vi.fn(), sendEnded: vi.fn() }));
vi.mock("@/lib/authz/grants", () => ({ getGrantStore: vi.fn() }));
import { sendApproved, sendEnded, sendGrants } from "@/lib/access-mail";
import { getGrantStore } from "@/lib/authz/grants";

import { AccessError, approve, dismiss, grantAction, listUsers, removeMember, revokeGrant } from "@/lib/access-admin";
import { GET as users } from "./users/route";
import { POST as approveRoute } from "./members/route";
import { DELETE as removeRoute } from "./members/[sub]/route";
import { DELETE as dismissRoute } from "./pending/[sub]/route";
import { PUT as grantRoute } from "./grants/route";
import { DELETE as revokeRoute } from "./grants/[sub]/[action]/route";

const user = { sub: "u1", username: "Google_1", email: "a@example.com", createdAt: "", groups: [] };
const json = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(sendApproved).mockResolvedValue(null);
  vi.mocked(sendGrants).mockResolvedValue(null);
  vi.mocked(sendEnded).mockResolvedValue(null);
  vi.mocked(getGrantStore).mockReturnValue({ list: vi.fn(async () => []) } as never);
});

describe("/api/access", () => {
  it("GET users returns the directory", async () => {
    vi.mocked(listUsers).mockResolvedValue([{ ...user, status: "pending", grants: [] }]);
    expect(await (await users()).json()).toEqual({ users: [{ ...user, status: "pending", grants: [] }] });
  });

  it("POST members approves and logs who did it", async () => {
    vi.mocked(approve).mockResolvedValue(user);
    const res = await approveRoute(json({ sub: "u1" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(approve).toHaveBeenCalledWith("u1");
    expect(console.info).toHaveBeenCalledWith(
      JSON.stringify({ event: "access", by: "owner@example.com", op: "approve", target: "a@example.com" }),
    );
  });

  it("DELETE members/[sub] removes, DELETE pending/[sub] dismisses", async () => {
    vi.mocked(removeMember).mockResolvedValue(user);
    vi.mocked(dismiss).mockResolvedValue(user);
    expect((await removeRoute(new Request("http://x"), params({ sub: "u1" }))).status).toBe(200);
    expect((await dismissRoute(new Request("http://x"), params({ sub: "u1" }))).status).toBe(200);
    expect(removeMember).toHaveBeenCalledWith("u1");
    expect(dismiss).toHaveBeenCalledWith("u1");
  });

  it("PUT grants validates, applies defaults and grants", async () => {
    vi.mocked(grantAction).mockResolvedValue({ user, grant: { expiresAt: 99 } as never });
    const res = await grantRoute(json({ sub: "u1", action: "newsdesk:ask" }));
    expect(res.status).toBe(200);
    expect(grantAction).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "u1", action: "newsdesk:ask", limit: 20, expiresInDays: 7, now: expect.any(Number) }),
    );
  });

  it.each([
    [{ sub: "u1", action: "resume:extract" }],
    [{ sub: "u1", action: "newsdesk:ask", limit: 0 }],
    [{ sub: "u1", action: "newsdesk:ask", limit: 1001 }],
    [{ sub: "u1", action: "newsdesk:ask", expiresInDays: 91 }],
    [{ sub: "u1", action: "newsdesk:ask", note: "x".repeat(201) }],
    [{ action: "newsdesk:ask" }],
  ])("PUT grants rejects %j with 400", async (body) => {
    const res = await grantRoute(json(body));
    expect(res.status).toBe(400);
    expect(grantAction).not.toHaveBeenCalled();
  });

  it("DELETE grants/[sub]/[action] receives the decoded action", async () => {
    vi.mocked(revokeGrant).mockResolvedValue(user);
    // Next decodes route params, so "newsdesk%3Aask" arrives as "newsdesk:ask".
    const res = await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "newsdesk:ask" }));
    expect(res.status).toBe(200);
    expect(revokeGrant).toHaveBeenCalledWith("u1", "newsdesk:ask");
  });

  it("DELETE grants rejects an action that isn't metered", async () => {
    const res = await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "keystatic:use" }));
    expect(res.status).toBe(400);
  });

  it.each([
    [new AccessError("the owner can't be changed here", 409), 409],
    [new AccessError("no such user", 404), 404],
  ])("maps %s to its status", async (err, status) => {
    vi.mocked(approve).mockRejectedValue(err);
    const res = await approveRoute(json({ sub: "u1" }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: err.message });
  });

  it("answers 500 for an unexpected failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(approve).mockRejectedValue(new Error("AccessDeniedException"));
    const res = await approveRoute(json({ sub: "u1" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "the change failed; nothing was changed" });
  });
});

describe("/api/access emails", () => {
  it("approve emails the new member", async () => {
    vi.mocked(approve).mockResolvedValue(user);
    expect(await (await approveRoute(json({ sub: "u1" }))).json()).toEqual({ ok: true });
    expect(sendApproved).toHaveBeenCalledWith(user);
  });

  it("reports a failed email without failing the change", async () => {
    vi.mocked(approve).mockResolvedValue(user);
    vi.mocked(sendApproved).mockResolvedValue("MessageRejected: Email address is not verified.");
    const res = await approveRoute(json({ sub: "u1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailError: "MessageRejected: Email address is not verified." });
  });

  it("grant emails every live grant the member now holds", async () => {
    const live = { action: "newsdesk:ask", limit: 20, used: 0, expiresAt: 9e9 };
    const spent = { action: "looper:process", limit: 5, used: 5, expiresAt: 9e9 };
    vi.mocked(grantAction).mockResolvedValue({ user, grant: live as never });
    vi.mocked(getGrantStore).mockReturnValue({ list: vi.fn(async () => [live, spent]) } as never);
    await grantRoute(json({ sub: "u1", action: "newsdesk:ask" }));
    expect(sendGrants).toHaveBeenCalledWith(user, [live]);
  });

  it("grant still answers ok and emails the new grant when listing the others fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const live = { action: "newsdesk:ask", limit: 20, used: 0, expiresAt: 9e9 };
    vi.mocked(grantAction).mockResolvedValue({ user, grant: live as never });
    vi.mocked(getGrantStore).mockReturnValue({
      list: vi.fn(async () => {
        throw new Error("ProvisionedThroughputExceededException");
      }),
    } as never);
    const res = await grantRoute(json({ sub: "u1", action: "newsdesk:ask" }));
    expect(res.status).toBe(200);
    expect(sendGrants).toHaveBeenCalledWith(user, [live]);
  });

  it("grant emails the new grant even when the read after the write is stale", async () => {
    const made = { action: "newsdesk:ask", limit: 20, used: 0, expiresAt: 9e9 };
    const old = { action: "newsdesk:ask", limit: 5, used: 5, expiresAt: 9e9 };
    const other = { action: "looper:process", limit: 5, used: 1, expiresAt: 9e9 };
    vi.mocked(grantAction).mockResolvedValue({ user, grant: made as never });
    vi.mocked(getGrantStore).mockReturnValue({ list: vi.fn(async () => [old, other]) } as never);
    await grantRoute(json({ sub: "u1", action: "newsdesk:ask" }));
    expect(sendGrants).toHaveBeenCalledWith(user, [other, made]);
  });

  it("remove and revoke email what ended; dismiss sends nothing", async () => {
    vi.mocked(removeMember).mockResolvedValue(user);
    vi.mocked(revokeGrant).mockResolvedValue(user);
    vi.mocked(dismiss).mockResolvedValue(user);
    await removeRoute(new Request("http://x"), params({ sub: "u1" }));
    await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "newsdesk:ask" }));
    await dismissRoute(new Request("http://x"), params({ sub: "u1" }));
    expect(sendEnded).toHaveBeenNthCalledWith(1, user, "the tools");
    expect(sendEnded).toHaveBeenNthCalledWith(2, user, "News Desk ask");
    expect(sendEnded).toHaveBeenCalledTimes(2);
  });
});
