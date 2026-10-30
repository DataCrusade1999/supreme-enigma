"use client";
import { useCallback, useEffect, useState } from "react";
import type { AccessStatus, AccessUser } from "../../lib/access-admin";
import type { Grant } from "../../lib/authz/grants";
import { METERED_ACTIONS, METERED_LABELS, type MeteredAction } from "../../lib/route-gate";

type Row = AccessUser & { status: AccessStatus; grants: Grant[] };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const until = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export function AccessAdmin() {
  const [users, setUsers] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/access/users");
    if (!res.ok) {
      setError("Couldn't load users.");
      return;
    }
    setUsers((await res.json()).users);
  }, []);

  useEffect(() => {
    // The directory is fetched once on mount; load() sets state only after the request returns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function change(url: string, init: RequestInit) {
    setError(null);
    setNotice(null);
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "The change failed.");
      return;
    }
    // Part 3 fills this in when the change saved but the email didn't send.
    if (body.emailError) setNotice(`Saved, but the email failed: ${body.emailError}`);
    await load();
  }

  const by = (status: AccessStatus) => (users ?? []).filter((u) => u.status === status);

  return (
    <div className="mt-10 flex flex-col gap-12">
      {error ? <p role="alert" className="text-sm text-accent">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-fg">{notice}</p> : null}

      <section aria-label="Pending">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted">Pending</h2>
        <ul className="mt-3 flex flex-col">
          {by("pending").map((u) => (
            <li key={u.sub} className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-line py-4">
              <span className="font-medium">{u.email}</span>
              <span className="text-sm text-muted">first signed in {day(u.createdAt)}</span>
              <span className="ml-auto flex gap-3 text-sm">
                <button aria-label={`Approve ${u.email}`} className="text-accent hover:text-fg"
                  onClick={() => change("/api/access/members", { method: "POST", body: JSON.stringify({ sub: u.sub }) })}>
                  Approve
                </button>
                <button aria-label={`Dismiss ${u.email}`} className="text-muted hover:text-fg"
                  onClick={() => change(`/api/access/pending/${encodeURIComponent(u.sub)}`, { method: "DELETE" })}>
                  Dismiss
                </button>
              </span>
            </li>
          ))}
          {users && by("pending").length === 0 ? <li className="py-4 text-sm text-muted">Nobody is waiting.</li> : null}
        </ul>
      </section>

      <section aria-label="Members">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted">Members</h2>
        <ul className="mt-3 flex flex-col">
          {by("member").map((u) => (
            <li key={u.sub} className="border-b border-line py-5">
              <div className="flex flex-wrap items-baseline gap-x-4">
                <span className="font-medium">{u.email}</span>
                <button aria-label={`Remove ${u.email}`} className="ml-auto text-sm text-muted hover:text-fg"
                  onClick={() => change(`/api/access/members/${encodeURIComponent(u.sub)}`, { method: "DELETE" })}>
                  Remove
                </button>
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {u.grants.map((g) => (
                  <li key={g.action} className="flex gap-3">
                    <span>
                      {METERED_LABELS[g.action]}: {g.limit - g.used} of {g.limit} left, expires {until(g.expiresAt)}
                    </span>
                    <button aria-label={`Revoke ${METERED_LABELS[g.action]} for ${u.email}`} className="text-muted hover:text-fg"
                      onClick={() =>
                        change(`/api/access/grants/${encodeURIComponent(u.sub)}/${encodeURIComponent(g.action)}`, { method: "DELETE" })
                      }>
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
              <GrantForm email={u.email} onGrant={(values) => change("/api/access/grants", { method: "PUT", body: JSON.stringify({ sub: u.sub, ...values }) })} />
            </li>
          ))}
          {users && by("member").length === 0 ? <li className="py-4 text-sm text-muted">No members yet.</li> : null}
        </ul>
      </section>

      <section aria-label="You">
        <h2 className="text-xs uppercase tracking-[0.14em] text-muted">You</h2>
        <ul className="mt-3">
          {by("owner").map((u) => (
            <li key={u.sub} className="py-2 text-sm">
              <span className="font-medium">{u.email}</span> <span className="text-muted">— owner, not editable here</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function GrantForm({
  email,
  onGrant,
}: {
  email: string;
  onGrant: (values: { action: MeteredAction; limit: number; expiresInDays: number; note: string }) => void;
}) {
  const [action, setAction] = useState<MeteredAction>("newsdesk:ask");
  const [limit, setLimit] = useState("20");
  const [days, setDays] = useState("7");
  const [note, setNote] = useState("");
  const id = email.replace(/[^a-z0-9]/gi, "-");

  return (
    <form
      aria-label={`Grant to ${email}`}
      className="mt-3 flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onGrant({ action, limit: Number(limit), expiresInDays: Number(days), note });
      }}
    >
      <label className="flex flex-col gap-1" htmlFor={`${id}-action`}>
        <span className="text-muted">Action</span>
        <select id={`${id}-action`} value={action} onChange={(e) => setAction(e.target.value as MeteredAction)} className="border border-line bg-bg px-2 py-1">
          {METERED_ACTIONS.map((a) => (
            <option key={a} value={a}>{METERED_LABELS[a]}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${id}-limit`}>
        <span className="text-muted">Uses</span>
        <input id={`${id}-limit`} type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(e.target.value)} className="w-20 border border-line bg-bg px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${id}-days`}>
        <span className="text-muted">Days</span>
        <input id={`${id}-days`} type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="w-16 border border-line bg-bg px-2 py-1" />
      </label>
      <label className="flex flex-1 flex-col gap-1" htmlFor={`${id}-note`}>
        <span className="text-muted">Note</span>
        <input id={`${id}-note`} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className="border border-line bg-bg px-2 py-1" />
      </label>
      <button type="submit" className="text-accent hover:text-fg">Grant</button>
    </form>
  );
}
