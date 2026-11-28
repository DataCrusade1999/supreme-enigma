"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateKeypair } from "../../lib/vpn/keys";
import { clientConfig, confFilename } from "../../lib/vpn/client-config";
import { serverStatus, type Desired, type Peer, type ServerReport, type Settings } from "../../lib/vpn/model";
import { NewPeerConfig } from "./NewPeerConfig";

const POLL_MS = 15_000;

function ago(then: number, now: number): string {
  if (!then) return "never";
  const s = Math.max(0, now - then);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

// What the dialog needs, held only while it is open.
type Shown = { config: string; filename: string };

export function VpnDashboard() {
  const [desired, setDesired] = useState<Desired | null>(null);
  const [server, setServer] = useState<ServerReport | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const latestLoad = useRef(0);

  const load = useCallback(async () => {
    const n = ++latestLoad.current;
    try {
      const res = await fetch("/api/vpn");
      if (n !== latestLoad.current) return;
      if (!res.ok) {
        setError("Couldn't load the VPN state.");
        return;
      }
      const body = await res.json();
      if (n !== latestLoad.current) return;
      setDesired(body.desired);
      setServer(body.server ?? null);
      setNow(Math.floor(Date.now() / 1000));
    } catch {
      if (n === latestLoad.current) setError("Couldn't load the VPN state.");
    }
  }, []);

  useEffect(() => {
    // Loads on mount; load() sets state only after the request returns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(typeof data.error === "string" ? data.error : "The change failed.");
      return { ok: res.ok, body: data };
    } catch {
      setError("The change failed.");
      return { ok: false, body: {} };
    } finally {
      setBusy(false);
    }
  }

  // Makes the keypair here, sends only the public half, and builds the config from the answer.
  async function issue(url: string, peerName: string | null): Promise<boolean> {
    if (!server) return false;
    const { privateKey, publicKey } = generateKeypair();
    const r = await send(url, "POST", peerName === null ? { publicKey } : { name: peerName, publicKey });
    if (!r.ok) return false;
    const d = r.body.desired as Desired;
    const peer = r.body.peer as Peer;
    setDesired(d);
    setShown({ config: clientConfig({ privateKey, peer, settings: d.settings, server }), filename: confFilename(peer.name) });
    void load();
    return true;
  }

  async function remove(id: string) {
    setConfirming(null);
    const r = await send(`/api/vpn/peers/${encodeURIComponent(id)}`, "DELETE");
    if (r.ok) {
      setDesired(r.body.desired as Desired);
      void load();
    }
  }

  async function saveSettings(s: Settings) {
    const r = await send("/api/vpn/settings", "PUT", s);
    if (r.ok) {
      setDesired(r.body.desired as Desired);
      void load();
    }
  }

  const status = desired ? serverStatus(server, desired, now) : null;
  const canIssue = !!server && !busy;

  return (
    <div className="mt-10 flex flex-col gap-12">
      {error ? <p role="alert" className="text-sm text-accent">{error}</p> : null}

      <section aria-label="Server">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted">Server</h2>
        <div className="mt-3 flex flex-col gap-1 text-sm">
          {status && server ? (
            <>
              <p>
                {status.online ? "Online" : "Offline"} <span className="text-muted">— last seen {ago(server.lastSeen, now)}</span>
                {status.applying ? <span className="text-muted"> · Applying…</span> : null}
              </p>
              {status.certExpiresSoon ? <p className="text-accent">The server certificate expires in under 30 days.</p> : null}
              {server.error ? <p className="text-accent">Agent error: {server.error}</p> : null}
            </>
          ) : desired ? (
            <p className="text-muted">The VPN server hasn&apos;t reported yet, so devices can&apos;t be added or re-issued.</p>
          ) : (
            <p className="text-muted">Loading…</p>
          )}
        </div>
      </section>

      {desired ? (
        <>
          <SettingsForm key={desired.settingsVersion} settings={desired.settings} disabled={busy} onSave={saveSettings} />

          <section aria-label="Peers">
            <h2 className="text-xs uppercase tracking-[0.14em] text-muted">Devices</h2>
            <ul className="mt-3 flex flex-col">
              {desired.peers.map((p) => {
                const st = server?.peers[p.publicKey];
                const stale = p.settingsVersion < desired.settingsVersion;
                return (
                  <li key={p.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line py-4 text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted">{p.address}</span>
                    <span className="text-muted">{st ? ago(st.latestHandshake, now) : "never"}</span>
                    {st ? <span className="text-muted">received {bytes(st.rxBytes)}</span> : null}
                    {st ? <span className="text-muted">sent {bytes(st.txBytes)}</span> : null}
                    {stale ? <span className="text-accent">Out of date — re-issue</span> : null}
                    <span className="ml-auto flex gap-3">
                      <button aria-label={`Re-issue ${p.name}`} className="text-accent hover:text-fg disabled:opacity-50" disabled={!canIssue}
                        onClick={() => void issue(`/api/vpn/peers/${encodeURIComponent(p.id)}/reissue`, null)}>
                        Re-issue
                      </button>
                      {confirming === p.id ? (
                        <>
                          <button aria-label={`Confirm remove ${p.name}`} className="text-accent hover:text-fg disabled:opacity-50" disabled={busy} onClick={() => void remove(p.id)}>
                            Confirm remove
                          </button>
                          <button className="text-muted hover:text-fg" onClick={() => setConfirming(null)}>Cancel</button>
                        </>
                      ) : (
                        <button aria-label={`Remove ${p.name}`} className="text-muted hover:text-fg disabled:opacity-50" disabled={busy} onClick={() => setConfirming(p.id)}>
                          Remove
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
              {desired.peers.length === 0 ? <li className="py-4 text-sm text-muted">No devices yet.</li> : null}
            </ul>

            <form
              aria-label="Add a device"
              className="mt-4 flex flex-wrap items-end gap-3 text-sm"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await issue("/api/vpn/peers", name.trim())) setName("");
              }}
            >
              <label className="flex flex-col gap-1" htmlFor="vpn-peer-name">
                <span className="text-muted">Name</span>
                <input id="vpn-peer-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="border border-line bg-bg px-2 py-1" />
              </label>
              <button type="submit" className="text-accent hover:text-fg disabled:opacity-50" disabled={!canIssue || name.trim() === ""}>
                Add peer
              </button>
            </form>
          </section>
        </>
      ) : null}

      {shown ? <NewPeerConfig config={shown.config} filename={shown.filename} onClose={() => setShown(null)} /> : null}
    </div>
  );
}

function SettingsForm({ settings, disabled, onSave }: { settings: Settings; disabled: boolean; onSave: (s: Settings) => void }) {
  const [dns, setDns] = useState(settings.dns.join(", "));
  const [tunnel, setTunnel] = useState(settings.tunnel);
  const [cidrs, setCidrs] = useState(settings.cidrs.join("\n"));
  const list = (s: string) => s.split(/[\s,]+/).filter(Boolean);

  return (
    <form
      aria-label="Settings"
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ dns: list(dns), tunnel, cidrs: list(cidrs) });
      }}
    >
      <h2 className="text-xs uppercase tracking-[0.14em] text-muted">Settings</h2>
      <label className="flex flex-col gap-1" htmlFor="vpn-dns">
        <span className="text-muted">DNS servers, comma-separated</span>
        <input id="vpn-dns" value={dns} onChange={(e) => setDns(e.target.value)} className="max-w-md border border-line bg-bg px-2 py-1" />
      </label>
      <fieldset className="flex gap-4">
        <legend className="mb-1 text-muted">Tunnel</legend>
        <label className="flex items-center gap-2"><input type="radio" name="tunnel" checked={tunnel === "full"} onChange={() => setTunnel("full")} />Full</label>
        <label className="flex items-center gap-2"><input type="radio" name="tunnel" checked={tunnel === "split"} onChange={() => setTunnel("split")} />Split</label>
      </fieldset>
      {tunnel === "split" ? (
        <label className="flex flex-col gap-1" htmlFor="vpn-cidrs">
          <span className="text-muted">CIDRs sent through the VPN, one per line</span>
          <textarea id="vpn-cidrs" rows={4} value={cidrs} onChange={(e) => setCidrs(e.target.value)} className="max-w-md border border-line bg-bg px-2 py-1" />
        </label>
      ) : null}
      <div>
        <button type="submit" className="text-accent hover:text-fg disabled:opacity-50" disabled={disabled}>Save settings</button>
        <span className="ml-3 text-muted">Existing devices keep their old config until re-issued.</span>
      </div>
    </form>
  );
}
