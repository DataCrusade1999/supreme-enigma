import { beforeEach, describe, expect, it } from "vitest";
import { addPeer } from "@/lib/vpn/model";
import { getVpnStore, mutateDesired, resetMemoryVpnStore } from "@/lib/vpn/store";
import { GET } from "./route";
import { PUT } from "./settings/route";
import { POST } from "./peers/route";
import { DELETE } from "./peers/[id]/route";
import { POST as REISSUE } from "./peers/[id]/reissue/route";

// 32 bytes, base64. The last char before "=" is canonical for 32 bytes.
function key(n: number): string {
  const bytes = new Uint8Array(32);
  bytes[0] = n & 255;
  bytes[1] = n >> 8;
  return btoa(String.fromCharCode(...bytes));
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const req = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.AUTHZ_MODE = "local";
  delete process.env.VERCEL;
  delete process.env.VPN_TABLE_NAME;
  resetMemoryVpnStore();
});

describe("/api/vpn", () => {
  it("GET returns the default desired and the fake server", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.desired.version).toBe(0);
    expect(body.desired.peers).toEqual([]);
    expect(body.server.endpoint).toBe("203.0.113.10:51820");
  });

  it("POST /api/vpn/peers adds a peer at 10.66.66.2 and returns it", async () => {
    const res = await POST(req("/api/vpn/peers", json({ name: "phone", publicKey: key(1) })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.peer.address).toBe("10.66.66.2");
    expect(body.peer.name).toBe("phone");
    expect(body.desired.peers).toEqual([body.peer]);
    expect(body.desired.version).toBe(1);
  });

  it("POST /api/vpn/peers refuses a name with a newline", async () => {
    const res = await POST(
      req("/api/vpn/peers", json({ name: "a\nPostUp = rm -rf /", publicKey: key(1) })),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("POST /api/vpn/peers refuses a bad public key", async () => {
    const res = await POST(req("/api/vpn/peers", json({ name: "phone", publicKey: "nope" })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("POST /api/vpn/peers refuses an unparsable body", async () => {
    const res = await POST(req("/api/vpn/peers", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("reissue keeps the address and swaps the key", async () => {
    const added = await (
      await POST(req("/api/vpn/peers", json({ name: "phone", publicKey: key(1) })))
    ).json();
    const id = added.peer.id;
    const res = await REISSUE(
      req(`/api/vpn/peers/${id}/reissue`, json({ publicKey: key(2) })),
      ctx(id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.peer.address).toBe("10.66.66.2");
    expect(body.peer.publicKey).toBe(key(2));
    expect(body.desired.peers).toHaveLength(1);
  });

  it("reissue refuses a bad public key", async () => {
    const added = await (
      await POST(req("/api/vpn/peers", json({ name: "phone", publicKey: key(1) })))
    ).json();
    const id = added.peer.id;
    const res = await REISSUE(
      req(`/api/vpn/peers/${id}/reissue`, json({ publicKey: "bad\n" })),
      ctx(id),
    );
    expect(res.status).toBe(400);
  });

  it("DELETE removes a peer", async () => {
    const added = await (
      await POST(req("/api/vpn/peers", json({ name: "phone", publicKey: key(1) })))
    ).json();
    const res = await DELETE(req(`/api/vpn/peers/${added.peer.id}`, { method: "DELETE" }), ctx(added.peer.id));
    expect(res.status).toBe(200);
    expect((await res.json()).desired.peers).toEqual([]);
  });

  it("DELETE an unknown id is 404", async () => {
    const res = await DELETE(req("/api/vpn/peers/nope", { method: "DELETE" }), ctx("nope"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("PUT settings with split and no cidrs is 400", async () => {
    const res = await PUT(
      req("/api/vpn/settings", { ...json({ dns: ["1.1.1.1"], tunnel: "split", cidrs: [] }), method: "PUT" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("PUT settings bumps settingsVersion", async () => {
    const res = await PUT(
      req("/api/vpn/settings", {
        ...json({ dns: ["9.9.9.9"], tunnel: "split", cidrs: ["10.0.0.0/8"] }),
        method: "PUT",
      }),
    );
    expect(res.status).toBe(200);
    const { desired } = await res.json();
    expect(desired.settingsVersion).toBe(2);
    expect(desired.settings).toEqual({ dns: ["9.9.9.9"], tunnel: "split", cidrs: ["10.0.0.0/8"] });
  });

  it("503 not_configured when no store", async () => {
    delete process.env.AUTHZ_MODE;
    delete process.env.VPN_TABLE_NAME;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
    const post = await POST(req("/api/vpn/peers", json({ name: "phone", publicKey: key(1) })));
    expect(post.status).toBe(503);
  });

  it("409 full when all 253 addresses are used", async () => {
    const store = getVpnStore()!;
    for (let i = 0; i < 253; i++) {
      await mutateDesired(store, (d) =>
        addPeer(d, { id: `id-${i}`, name: `p${i}`, publicKey: key(i), now: 1 }),
      );
    }
    const res = await POST(req("/api/vpn/peers", json({ name: "extra", publicKey: key(1000) })));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "full" });
    expect((await store.read()).desired.peers).toHaveLength(253);
  });
});
