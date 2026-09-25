"use client";

import { useState } from "react";
import { formatAge } from "../../lib/news-desk/format";
import type { Snapshot } from "../../lib/news-desk/types";
import { HeadlineList } from "./HeadlineList";

export function NewsDesk({
  initial,
  problem,
  nowIso,
}: {
  initial: Snapshot | null;
  problem: string | null;
  nowIso: string;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ages are computed against the server's render time, never `new Date()` in
  // render: the server and the browser would print different "Nm ago" strings
  // and React would report a hydration mismatch. Updated only in the click
  // handler, which runs in the browser alone.
  const [now, setNow] = useState(() => new Date(nowIso));

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/news-desk/refresh", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(`Refresh failed: ${body?.error ?? `status ${res.status}`}`);
        return;
      }
      setSnapshot(body as Snapshot);
      setNow(new Date());
    } catch {
      setError("Refresh failed: network error");
    } finally {
      setRefreshing(false);
    }
  }

  const failed = snapshot?.sourceErrors ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
        <div className="text-xs text-muted">
          {snapshot ? <span>Refreshed {formatAge(snapshot.refreshedAt, now)}</span> : <span>Never refreshed</span>}
          {failed.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer">
                {failed.length} {failed.length === 1 ? "source" : "sources"} failed
              </summary>
              <ul className="mt-1">
                {failed.map((f) => (
                  <li key={f.source}>
                    {f.source}: {f.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="rounded-md border border-rule px-3 py-1.5 text-sm text-fg disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-accent">
          {error}
        </p>
      )}

      {problem ? (
        <p className="mt-6 text-sm text-muted">{problem}</p>
      ) : snapshot && snapshot.headlines.length > 0 ? (
        <HeadlineList headlines={snapshot.headlines} now={now} />
      ) : (
        <p className="mt-6 text-sm text-muted">Nothing saved yet. Press Refresh to fetch headlines.</p>
      )}
    </div>
  );
}
