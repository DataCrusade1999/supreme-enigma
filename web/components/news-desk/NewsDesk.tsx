"use client";

import { useState } from "react";
import { formatAge } from "../../lib/news-desk/format";
import { TOPICS, type Snapshot, type Topic } from "../../lib/news-desk/types";
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
  const [tab, setTab] = useState<"All" | Topic>("All");
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
  // Drop items stay in the snapshot so they are not re-tagged on the next
  // refresh; they are never shown. Untagged items appear only under All.
  const shown = (snapshot?.headlines ?? []).filter((h) => h.tag !== "Drop");
  const tabs: { label: "All" | Topic; count: number }[] = [
    { label: "All", count: shown.length },
    ...TOPICS.map((t) => ({ label: t, count: shown.filter((h) => h.tag === t).length })),
  ];
  const visible = tab === "All" ? shown : shown.filter((h) => h.tag === tab);

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
        <>
          <div role="tablist" aria-label="Topics" className="mt-4 flex flex-wrap gap-4 border-b border-rule">
            {tabs.map(({ label, count }) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={tab === label}
                onClick={() => setTab(label)}
                className={`-mb-px border-b-2 pb-2 text-sm ${
                  tab === label ? "border-accent text-fg" : "border-transparent text-muted"
                }`}
              >
                {label}{" "}
                <span className="text-xs text-muted">{count}</span>
              </button>
            ))}
          </div>
          {visible.length > 0 ? (
            <HeadlineList headlines={visible} now={now} />
          ) : (
            <p className="mt-6 text-sm text-muted">No headlines tagged {tab}.</p>
          )}
        </>
      ) : (
        <p className="mt-6 text-sm text-muted">Nothing saved yet. Press Refresh to fetch headlines.</p>
      )}
    </div>
  );
}
