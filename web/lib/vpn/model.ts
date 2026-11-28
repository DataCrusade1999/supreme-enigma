import { z } from "@/lib/zod";

// Item shapes shared with the VPN server's agent. Do not change them without the agent.

export type Settings = {
  dns: string[];
  tunnel: "full" | "split";
  cidrs: string[];
};

export type Peer = {
  id: string;
  name: string;
  publicKey: string;
  address: string;
  createdAt: number;
  settingsVersion: number;
};

export type Desired = {
  pk: "desired";
  version: number;
  settingsVersion: number;
  settings: Settings;
  peers: Peer[];
};

export type PeerStats = {
  latestHandshake: number;
  rxBytes: number;
  txBytes: number;
};

export type ServerReport = {
  pk: "server";
  publicKey: string;
  endpoint: string;
  appliedVersion: number;
  lastSeen: number;
  certNotAfter: number;
  error: string | null;
  peers: Record<string, PeerStats>;
};

export class VpnError extends Error {
  code: "full" | "not_found" | "bad_request";
  constructor(code: VpnError["code"], message: string = code) {
    super(message);
    this.name = "VpnError";
    this.code = code;
  }
}

export const DEFAULT_DESIRED: Desired = {
  pk: "desired",
  version: 0,
  settingsVersion: 1,
  settings: { dns: ["1.1.1.1", "1.0.0.1"], tunnel: "full", cidrs: [] },
  peers: [],
};

const ADDRESS_PREFIX = "10.66.66.";
const FIRST_HOST = 2;
const LAST_HOST = 254;

const ONLINE_WINDOW_S = 180;
const CERT_WARNING_S = 30 * 86400;

// WireGuard public key: base64 of exactly 32 bytes. The regex has no multiline
// flag, so `$` only matches at the end of input and a trailing newline fails.
export function isPublicKey(s: string): boolean {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(s)) return false;
  try {
    return atob(s).length === 32;
  } catch {
    return false;
  }
}

const OCTET = "(?:0|[1-9][0-9]{0,2})";
const IPV4_RE = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`);

function isIpv4(s: string): boolean {
  return IPV4_RE.test(s) && s.split(".").every((o) => Number(o) <= 255);
}

function isIpv4Cidr(s: string): boolean {
  const i = s.indexOf("/");
  if (i < 0) return false;
  const prefix = s.slice(i + 1);
  return isIpv4(s.slice(0, i)) && /^[0-9]{1,2}$/.test(prefix) && Number(prefix) <= 32;
}

export const peerInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9 ._-]+$/),
  publicKey: z.string().refine(isPublicKey, "not a WireGuard public key"),
});

export const settingsSchema = z
  .object({
    dns: z.array(z.string().refine(isIpv4, "not an IPv4 address")).min(1).max(3),
    tunnel: z.enum(["full", "split"]),
    cidrs: z.array(z.string()),
  })
  .superRefine((s, ctx) => {
    if (s.tunnel !== "split") return;
    if (s.cidrs.length < 1 || s.cidrs.length > 32) {
      ctx.addIssue({ code: "custom", path: ["cidrs"], message: "split needs 1 to 32 CIDRs" });
      return;
    }
    s.cidrs.forEach((c, i) => {
      if (!isIpv4Cidr(c)) {
        ctx.addIssue({ code: "custom", path: ["cidrs", i], message: "not an IPv4 CIDR" });
      }
    });
  });

export function nextAddress(peers: Peer[]): string | null {
  const used = new Set(peers.map((p) => p.address));
  for (let n = FIRST_HOST; n <= LAST_HOST; n++) {
    const a = `${ADDRESS_PREFIX}${n}`;
    if (!used.has(a)) return a;
  }
  return null;
}

export function addPeer(
  d: Desired,
  p: { id: string; name: string; publicKey: string; now: number },
): Desired {
  if (d.peers.some((x) => x.publicKey === p.publicKey)) {
    throw new VpnError("bad_request", "public key already in use");
  }
  const address = nextAddress(d.peers);
  if (address === null) throw new VpnError("full");
  const peer: Peer = {
    id: p.id,
    name: p.name,
    publicKey: p.publicKey,
    address,
    createdAt: p.now,
    settingsVersion: d.settingsVersion,
  };
  return { ...d, version: d.version + 1, peers: [...d.peers, peer] };
}

export function removePeer(d: Desired, id: string): Desired {
  if (!d.peers.some((p) => p.id === id)) throw new VpnError("not_found");
  return { ...d, version: d.version + 1, peers: d.peers.filter((p) => p.id !== id) };
}

export function reissuePeer(d: Desired, id: string, publicKey: string): Desired {
  if (!d.peers.some((p) => p.id === id)) throw new VpnError("not_found");
  if (d.peers.some((p) => p.id !== id && p.publicKey === publicKey)) {
    throw new VpnError("bad_request", "public key already in use");
  }
  return {
    ...d,
    version: d.version + 1,
    peers: d.peers.map((p) =>
      p.id === id ? { ...p, publicKey, settingsVersion: d.settingsVersion } : p,
    ),
  };
}

export function updateSettings(d: Desired, s: Settings): Desired {
  return {
    ...d,
    version: d.version + 1,
    settingsVersion: d.settingsVersion + 1,
    settings: { dns: [...s.dns], tunnel: s.tunnel, cidrs: [...s.cidrs] },
  };
}

export function allowedIps(s: Settings): string[] {
  if (s.tunnel === "full") return ["0.0.0.0/0", "::/0"];
  const out = [...s.cidrs];
  for (const dns of s.dns) {
    const host = `${dns}/32`;
    if (!out.includes(host)) out.push(host);
  }
  return out;
}

export function serverStatus(
  server: ServerReport | null,
  d: Desired,
  now: number,
): { seen: boolean; online: boolean; applying: boolean; certExpiresSoon: boolean } {
  if (server === null) {
    return { seen: false, online: false, applying: false, certExpiresSoon: false };
  }
  return {
    seen: true,
    online: now - server.lastSeen < ONLINE_WINDOW_S,
    applying: server.appliedVersion < d.version,
    certExpiresSoon: server.certNotAfter - now < CERT_WARNING_S,
  };
}
