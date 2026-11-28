import { allowedIps, type Peer, type ServerReport, type Settings } from "./model";

export function clientConfig(a: { privateKey: string; peer: Peer; settings: Settings; server: ServerReport }): string {
  return [
    "[Interface]",
    `PrivateKey = ${a.privateKey}`,
    `Address = ${a.peer.address}/32`,
    `DNS = ${a.settings.dns.join(", ")}`,
    "",
    "[Peer]",
    `PublicKey = ${a.server.publicKey}`,
    `Endpoint = ${a.server.endpoint}`,
    `AllowedIPs = ${allowedIps(a.settings).join(", ")}`,
    "PersistentKeepalive = 25",
    "",
  ].join("\n");
}

export function confFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${slug || "wg-peer"}.conf`;
}
