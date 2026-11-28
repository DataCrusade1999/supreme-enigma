import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIRED,
  VpnError,
  addPeer,
  allowedIps,
  isPublicKey,
  nextAddress,
  peerInputSchema,
  reissuePeer,
  removePeer,
  serverStatus,
  settingsSchema,
  updateSettings,
  type Desired,
  type Peer,
  type ServerReport,
} from "./model";

const KEY_A = "A".repeat(43) + "=";
const KEY_B = "B".repeat(43) + "=";
const KEY_C = "C".repeat(43) + "=";

function peer(n: number, over: Partial<Peer> = {}): Peer {
  return {
    id: `id-${n}`,
    name: `peer ${n}`,
    publicKey: `${String(n).padStart(3, "0")}${"A".repeat(40)}=`,
    address: `10.66.66.${n}`,
    createdAt: 1000,
    settingsVersion: 1,
    ...over,
  };
}

function withPeers(peers: Peer[], over: Partial<Desired> = {}): Desired {
  return { ...DEFAULT_DESIRED, peers, ...over };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof VpnError ? e.code : "not-a-VpnError";
  }
  return undefined;
}

describe("nextAddress", () => {
  it("nextAddress returns 10.66.66.2 for no peers and fills the lowest gap", () => {
    expect(nextAddress([])).toBe("10.66.66.2");
    expect(nextAddress([peer(2), peer(4)])).toBe("10.66.66.3");
  });
});

describe("addPeer", () => {
  it("addPeer throws full when 253 peers exist", () => {
    const peers = Array.from({ length: 253 }, (_, i) => peer(i + 2));
    expect(nextAddress(peers)).toBeNull();
    const d = withPeers(peers);
    const input = { id: "x", name: "n", publicKey: KEY_B, now: 1 };
    expect(() => addPeer(d, input)).toThrow(VpnError);
    expect(codeOf(() => addPeer(d, input))).toBe("full");
  });

  it("addPeer stamps the current settingsVersion and bumps version", () => {
    const d = withPeers([], { version: 4, settingsVersion: 7 });
    const out = addPeer(d, { id: "u1", name: "phone", publicKey: KEY_A, now: 555 });
    expect(out.version).toBe(5);
    expect(out.settingsVersion).toBe(7);
    expect(out.peers).toEqual([
      {
        id: "u1",
        name: "phone",
        publicKey: KEY_A,
        address: "10.66.66.2",
        createdAt: 555,
        settingsVersion: 7,
      },
    ]);
    expect(d.peers).toEqual([]);
    expect(d.version).toBe(4);
  });

  it("addPeer refuses a public key already in use", () => {
    const d = withPeers([peer(2, { publicKey: KEY_A })]);
    expect(codeOf(() => addPeer(d, { id: "x", name: "n", publicKey: KEY_A, now: 1 }))).toBe(
      "bad_request",
    );
  });
});

describe("removePeer and reissuePeer", () => {
  it("removePeer and reissuePeer throw not_found for an unknown id", () => {
    const d = withPeers([peer(2)]);
    expect(codeOf(() => removePeer(d, "nope"))).toBe("not_found");
    expect(codeOf(() => reissuePeer(d, "nope", KEY_B))).toBe("not_found");
  });

  it("removePeer drops the peer and bumps version", () => {
    const d = withPeers([peer(2), peer(3)], { version: 2 });
    const out = removePeer(d, "id-2");
    expect(out.peers.map((p) => p.id)).toEqual(["id-3"]);
    expect(out.version).toBe(3);
    expect(d.peers).toHaveLength(2);
  });

  it("reissuePeer keeps id, name and address and swaps the key", () => {
    const d = withPeers([peer(2, { settingsVersion: 1 })], { version: 3, settingsVersion: 6 });
    const out = reissuePeer(d, "id-2", KEY_C);
    expect(out.version).toBe(4);
    expect(out.peers[0]).toEqual({
      ...d.peers[0],
      publicKey: KEY_C,
      settingsVersion: 6,
    });
    expect(d.peers[0].publicKey).not.toBe(KEY_C);
  });

  it("reissuePeer refuses a key used by another peer", () => {
    const d = withPeers([peer(2, { publicKey: KEY_A }), peer(3, { publicKey: KEY_B })]);
    expect(codeOf(() => reissuePeer(d, "id-2", KEY_B))).toBe("bad_request");
  });
});

describe("updateSettings", () => {
  it("updateSettings bumps settingsVersion so older peers read as out of date", () => {
    const d = withPeers([peer(2, { settingsVersion: 1 })], { version: 1, settingsVersion: 1 });
    const settings = { dns: ["9.9.9.9"], tunnel: "split" as const, cidrs: ["10.1.0.0/16"] };
    const out = updateSettings(d, settings);
    expect(out.version).toBe(2);
    expect(out.settingsVersion).toBe(2);
    expect(out.settings).toEqual(settings);
    expect(out.peers[0].settingsVersion).toBeLessThan(out.settingsVersion);
    expect(d.settings).toEqual(DEFAULT_DESIRED.settings);
  });
});

describe("isPublicKey", () => {
  it("isPublicKey refuses newline and padding tricks", () => {
    expect(isPublicKey(KEY_A)).toBe(true);
    expect(isPublicKey(KEY_A + "\n")).toBe(false);
    expect(isPublicKey("A".repeat(32))).toBe(false);
    expect(isPublicKey("PostUp = x")).toBe(false);
    expect(isPublicKey(btoa("A".repeat(31)))).toBe(false);
    expect(isPublicKey(btoa("A".repeat(33)))).toBe(false);
    expect(isPublicKey(btoa("A".repeat(32)))).toBe(true);
  });
});

describe("peerInputSchema", () => {
  it("accepts a valid name and key", () => {
    expect(peerInputSchema.safeParse({ name: "My phone_1.x-y", publicKey: KEY_A }).success).toBe(
      true,
    );
  });

  it("refuses a name with a trailing newline, bad characters, or a bad length", () => {
    expect(peerInputSchema.safeParse({ name: "phone\n", publicKey: KEY_A }).success).toBe(false);
    expect(peerInputSchema.safeParse({ name: "a\nPostUp = x", publicKey: KEY_A }).success).toBe(
      false,
    );
    expect(peerInputSchema.safeParse({ name: "", publicKey: KEY_A }).success).toBe(false);
    expect(peerInputSchema.safeParse({ name: "a".repeat(41), publicKey: KEY_A }).success).toBe(
      false,
    );
    expect(peerInputSchema.safeParse({ name: "a".repeat(40), publicKey: KEY_A }).success).toBe(
      true,
    );
  });

  it("refuses a public key with a trailing newline", () => {
    expect(peerInputSchema.safeParse({ name: "ok", publicKey: KEY_A + "\n" }).success).toBe(false);
  });
});

describe("allowedIps", () => {
  it("full tunnel routes 0.0.0.0/0 and ::/0", () => {
    expect(allowedIps({ dns: ["1.1.1.1"], tunnel: "full", cidrs: [] })).toEqual([
      "0.0.0.0/0",
      "::/0",
    ]);
  });

  it("split tunnel adds each DNS server's /32", () => {
    expect(
      allowedIps({ tunnel: "split", cidrs: ["10.1.0.0/16"], dns: ["1.1.1.1", "9.9.9.9"] }),
    ).toEqual(["10.1.0.0/16", "1.1.1.1/32", "9.9.9.9/32"]);
    expect(
      allowedIps({
        tunnel: "split",
        cidrs: ["10.1.0.0/16", "1.1.1.1/32"],
        dns: ["1.1.1.1", "9.9.9.9"],
      }),
    ).toEqual(["10.1.0.0/16", "1.1.1.1/32", "9.9.9.9/32"]);
  });
});

describe("settingsSchema", () => {
  const ok = { dns: ["1.1.1.1"], tunnel: "split", cidrs: ["10.0.0.0/8"] };

  it("settingsSchema requires cidrs for split and rejects IPv6 and bad CIDRs", () => {
    expect(settingsSchema.safeParse(ok).success).toBe(true);
    expect(settingsSchema.safeParse({ ...ok, cidrs: [] }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...ok, cidrs: ["10.0.0.0/33"] }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...ok, cidrs: ["::/0"] }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...ok, cidrs: ["300.1.1.1"] }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...ok, cidrs: ["10.0.0.0/8\n"] }).success).toBe(false);
    const tooMany = Array.from({ length: 33 }, (_, i) => `10.${i}.0.0/16`);
    expect(settingsSchema.safeParse({ ...ok, cidrs: tooMany }).success).toBe(false);
  });

  it("accepts empty cidrs for full tunnel", () => {
    expect(settingsSchema.safeParse({ dns: ["1.1.1.1"], tunnel: "full", cidrs: [] }).success).toBe(
      true,
    );
  });

  it("requires 1 to 3 IPv4 DNS addresses", () => {
    const bad = (dns: string[]) => settingsSchema.safeParse({ ...ok, dns }).success;
    expect(bad([])).toBe(false);
    expect(bad(["1.1.1.1", "1.0.0.1", "9.9.9.9", "8.8.8.8"])).toBe(false);
    expect(bad(["::1"])).toBe(false);
    expect(bad(["1.1.1.256"])).toBe(false);
    expect(bad(["1.1.1.1/32"])).toBe(false);
    expect(bad(["1.1.1.1", "1.0.0.1", "9.9.9.9"])).toBe(true);
  });

  it("refuses an unknown tunnel mode", () => {
    expect(settingsSchema.safeParse({ ...ok, tunnel: "other" }).success).toBe(false);
  });
});

describe("serverStatus", () => {
  const server = (over: Partial<ServerReport> = {}): ServerReport => ({
    pk: "server",
    publicKey: KEY_A,
    endpoint: "1.2.3.4:51820",
    appliedVersion: 5,
    lastSeen: 1000,
    certNotAfter: 1000 + 60 * 86400,
    error: null,
    peers: {},
    ...over,
  });
  const d = withPeers([], { version: 5 });

  it("serverStatus: unseen, offline after 180 s, applying, cert warning inside 30 days", () => {
    expect(serverStatus(null, d, 1000)).toEqual({
      seen: false,
      online: false,
      applying: false,
      certExpiresSoon: false,
    });
    expect(serverStatus(server(), d, 1179)).toMatchObject({ seen: true, online: true });
    expect(serverStatus(server(), d, 1180).online).toBe(false);
    expect(serverStatus(server({ appliedVersion: 4 }), d, 1000).applying).toBe(true);
    expect(serverStatus(server({ appliedVersion: 5 }), d, 1000).applying).toBe(false);
    const soon = server({ certNotAfter: 1000 + 30 * 86400 - 1 });
    expect(serverStatus(soon, d, 1000).certExpiresSoon).toBe(true);
    const later = server({ certNotAfter: 1000 + 30 * 86400 });
    expect(serverStatus(later, d, 1000).certExpiresSoon).toBe(false);
  });
});

describe("DEFAULT_DESIRED", () => {
  it("matches the shape the agent expects", () => {
    expect(DEFAULT_DESIRED).toEqual({
      pk: "desired",
      version: 0,
      settingsVersion: 1,
      settings: { dns: ["1.1.1.1", "1.0.0.1"], tunnel: "full", cidrs: [] },
      peers: [],
    });
  });
});
