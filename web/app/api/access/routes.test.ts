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
vi.mock("@/lib/access-mail", () => ({ sendWelcome: vi.fn(), sendUpdate: vi.fn(), sendEnded: vi.fn() }));
const marker = vi.hoisted(() => ({ wasWelcomed: vi.fn(), markWelcomed: vi.fn() }));
vi.mock("@/lib/authz/grants", () => ({ getGrantStore: vi.fn(() => marker) }));
import { sendEnded, sendUpdate, sendWelcome } from "@/lib/access-mail";

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
  vi.mocked(sendWelcome).mockResolvedValue(null);
  vi.mocked(sendUpdate).mockResolvedValue(null);
  vi.mocked(sendEnded).mockResolvedValue(null);
  marker.wasWelcomed.mockResolvedValue(false);
  marker.markWelcomed.mockResolvedValue(undefined);
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
    vi.mocked(removeMember).mockResolvedValue({ user, hadLive: false });
    vi.mocked(dismiss).mockResolvedValue(user);
    expect((await removeRoute(new Request("http://x"), params({ sub: "u1" }))).status).toBe(200);
    expect((await dismissRoute(new Request("http://x"), params({ sub: "u1" }))).status).toBe(200);
    expect(removeMember).toHaveBeenCalledWith("u1");
    expect(dismiss).toHaveBeenCalledWith("u1");
  });

  it("PUT grants validates, applies defaults and grants", async () => {
    vi.mocked(grantAction).mockResolvedValue({ user, grant: { expiresAt: 99 } as never, opensTool: true });
    const res = await grantRoute(json({ sub: "u1", action: "newsdesk:ask" }));
    expect(res.status).toBe(200);
    expect(grantAction).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "u1", action: "newsdesk:ask", limit: 20, expiresInDays: 7, now: expect.any(Number) }),
    );
  });

  it("PUT grants for a time-only key needs no limit and passes none", async () => {
    vi.mocked(grantAction).mockResolvedValue({ user, grant: { action: "moneyplanner:use", expiresAt: 99 } as never, opensTool: true });
    const res = await grantRoute(json({ sub: "u1", action: "moneyplanner:use" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(grantAction).mock.calls[0][0]).not.toHaveProperty("limit");
  });

  it("PUT grants drops a limit sent for a time-only key", async () => {
    vi.mocked(grantAction).mockResolvedValue({ user, grant: { action: "moneyplanner:use", expiresAt: 99 } as never, opensTool: true });
    await grantRoute(json({ sub: "u1", action: "moneyplanner:use", limit: 5 }));
    expect(vi.mocked(grantAction).mock.calls[0][0]).not.toHaveProperty("limit");
  });

  it.each([
    [{ sub: "u1", action: "resume:extract" }],
    [{ sub: "u1", action: "keystatic:use" }],
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
    vi.mocked(revokeGrant).mockResolvedValue({ user, removed: null });
    // Next decodes route params, so "newsdesk%3Aask" arrives as "newsdesk:ask".
    const res = await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "newsdesk:ask" }));
    expect(res.status).toBe(200);
    expect(revokeGrant).toHaveBeenCalledWith("u1", "newsdesk:ask");
  });

  it("DELETE grants rejects a key that isn't a grant", async () => {
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
  const ask = { action: "newsdesk:ask", expiresAt: 9e9 } as never;
  const grantFor = (action = "newsdesk:ask") => grantRoute(json({ sub: "u1", action }));

  it("approve sends nothing", async () => {
    vi.mocked(approve).mockResolvedValue(user);
    expect(await (await approveRoute(json({ sub: "u1" }))).json()).toEqual({ ok: true });
    expect(sendWelcome).not.toHaveBeenCalled();
    expect(sendUpdate).not.toHaveBeenCalled();
    expect(sendEnded).not.toHaveBeenCalled();
  });

  it("the first grant sends the welcome, then marks the member welcomed", async () => {
    vi.mocked(grantAction).mockResolvedValue({ user, grant: ask, opensTool: true });
    const res = await grantFor();
    expect(await res.json()).toEqual({ ok: true });
    expect(sendWelcome).toHaveBeenCalledWith(user, ask);
    expect(marker.markWelcomed).toHaveBeenCalledWith("u1", expect.any(Number));
    expect(sendUpdate).not.toHaveBeenCalled();
  });

  it("a failed welcome is reported and the member is not marked", async () => {
    vi.mocked(grantAction).mockResolvedValue({ user, grant: ask, opensTool: true });
    vi.mocked(sendWelcome).mockResolvedValue("MessageRejected: Email address is not verified.");
    const res = await grantFor();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailError: "MessageRejected: Email address is not verified." });
    expect(marker.markWelcomed).not.toHaveBeenCalled();
  });

  it("a welcome that throws still answers 200 with the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(grantAction).mockResolvedValue({ user, grant: ask, opensTool: true });
    vi.mocked(sendWelcome).mockRejectedValue(new Error("boom"));
    const res = await grantFor();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailError: "Error: boom" });
    expect(marker.markWelcomed).not.toHaveBeenCalled();
  });

  it("an update that throws still answers 200 with the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    marker.wasWelcomed.mockResolvedValue(true);
    vi.mocked(grantAction).mockResolvedValue({ user, grant: ask, opensTool: false });
    vi.mocked(sendUpdate).mockRejectedValue(new Error("boom"));
    const res = await grantFor();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailError: "Error: boom" });
  });

  it.each([true, false])("a welcomed member gets an update with opensTool %s", async (opensTool) => {
    marker.wasWelcomed.mockResolvedValue(true);
    vi.mocked(grantAction).mockResolvedValue({ user, grant: ask, opensTool });
    await grantFor();
    expect(sendUpdate).toHaveBeenCalledWith(user, ask, opensTool);
    expect(sendWelcome).not.toHaveBeenCalled();
    expect(marker.markWelcomed).not.toHaveBeenCalled();
  });

  it("answers 200 and sends the update when reading the marker throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    marker.wasWelcomed.mockRejectedValue(new Error("ProvisionedThroughputExceededException"));
    vi.mocked(grantAction).mockResolvedValue({ user, grant: ask, opensTool: true });
    const res = await grantFor();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendUpdate).toHaveBeenCalledWith(user, ask, true);
    expect(sendWelcome).not.toHaveBeenCalled();
  });

  it("answers 200 without an email error when writing the marker throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    marker.markWelcomed.mockRejectedValue(new Error("boom"));
    vi.mocked(grantAction).mockResolvedValue({ user, grant: ask, opensTool: true });
    const res = await grantFor();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendWelcome).toHaveBeenCalled();
  });

  it("revoke of an unexpired grant says what ended", async () => {
    vi.mocked(revokeGrant).mockResolvedValue({ user, removed: { action: "newsdesk:ask", expiresAt: 9e9 } as never });
    await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "newsdesk:ask" }));
    expect(sendEnded).toHaveBeenCalledWith(user, "News Desk ask");
  });

  it("revoke of an expired or missing grant sends nothing", async () => {
    vi.mocked(revokeGrant).mockResolvedValueOnce({ user, removed: { action: "newsdesk:ask", expiresAt: 1 } as never });
    await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "newsdesk:ask" }));
    vi.mocked(revokeGrant).mockResolvedValueOnce({ user, removed: null });
    await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "newsdesk:ask" }));
    expect(sendEnded).not.toHaveBeenCalled();
  });

  it("remove sends the ended email only for a member with a live grant", async () => {
    vi.mocked(removeMember).mockResolvedValueOnce({ user, hadLive: true });
    await removeRoute(new Request("http://x"), params({ sub: "u1" }));
    expect(sendEnded).toHaveBeenCalledWith(user, "the tools");
    vi.mocked(sendEnded).mockClear();
    vi.mocked(removeMember).mockResolvedValueOnce({ user, hadLive: false });
    await removeRoute(new Request("http://x"), params({ sub: "u1" }));
    expect(sendEnded).not.toHaveBeenCalled();
  });

  it("revoke with an unreadable grant sends nothing and says so", async () => {
    vi.mocked(revokeGrant).mockResolvedValueOnce({ user, removed: "unknown" });
    const res = await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "newsdesk:ask" }));
    expect(res.status).toBe(200);
    expect(sendEnded).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, emailError: "Couldn't read the grant before revoking it, so no email was sent." });
  });

  it("remove with unreadable grants sends nothing and says so", async () => {
    vi.mocked(removeMember).mockResolvedValueOnce({ user, hadLive: "unknown" });
    const res = await removeRoute(new Request("http://x"), params({ sub: "u1" }));
    expect(res.status).toBe(200);
    expect(sendEnded).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, emailError: "Couldn't read the member's grants before removing them, so no email was sent." });
  });

  it("an ended email that throws still answers 200 with the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(removeMember).mockResolvedValue({ user, hadLive: true });
    vi.mocked(sendEnded).mockRejectedValue(new Error("boom"));
    const res = await removeRoute(new Request("http://x"), params({ sub: "u1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailError: "Error: boom" });
  });

  it("dismiss sends nothing", async () => {
    vi.mocked(dismiss).mockResolvedValue(user);
    await dismissRoute(new Request("http://x"), params({ sub: "u1" }));
    expect(sendEnded).not.toHaveBeenCalled();
    expect(sendWelcome).not.toHaveBeenCalled();
  });
});
