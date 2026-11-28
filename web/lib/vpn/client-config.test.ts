import { describe, expect, it } from "vitest";
import { clientConfig, confFilename } from "./client-config";
import type { Peer, ServerReport, Settings } from "./model";

const peer: Peer = { id: "1", name: "Pixel", publicKey: "x", address: "10.66.66.2", createdAt: 0, settingsVersion: 1 };
const server: ServerReport = {
  pk: "server", publicKey: "SERVERKEY", endpoint: "1.2.3.4:51820", appliedVersion: 1,
  lastSeen: 0, certNotAfter: 0, error: null, peers: {},
};

describe("clientConfig", () => {
  it("renders the exact config text", () => {
    const full: Settings = { dns: ["1.1.1.1", "1.0.0.1"], tunnel: "full", cidrs: [] };
    expect(clientConfig({ privateKey: "PRIV", peer, settings: full, server })).toBe(
      "[Interface]\nPrivateKey = PRIV\nAddress = 10.66.66.2/32\nDNS = 1.1.1.1, 1.0.0.1\n\n" +
        "[Peer]\nPublicKey = SERVERKEY\nEndpoint = 1.2.3.4:51820\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n",
    );
    const split: Settings = { dns: ["9.9.9.9"], tunnel: "split", cidrs: ["10.0.0.0/8"] };
    expect(clientConfig({ privateKey: "PRIV", peer, settings: split, server })).toBe(
      "[Interface]\nPrivateKey = PRIV\nAddress = 10.66.66.2/32\nDNS = 9.9.9.9\n\n" +
        "[Peer]\nPublicKey = SERVERKEY\nEndpoint = 1.2.3.4:51820\nAllowedIPs = 10.0.0.0/8, 9.9.9.9/32\nPersistentKeepalive = 25\n",
    );
  });

  it("confFilename slugs and caps at 32", () => {
    expect(confFilename("Ashu's Pixel 9")).toBe("ashu-s-pixel-9.conf");
    expect(confFilename("***")).toBe("wg-peer.conf");
    expect(confFilename("a".repeat(60))).toBe(`${"a".repeat(32)}.conf`);
  });
});
