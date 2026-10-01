"use client";

import { useState } from "react";
import { formatAge } from "../../lib/news-desk/format";
import { TOPICS, type Topic } from "../../lib/news-desk/tags";
import { regionOf, type IndicatorValue, type Region, type Snapshot } from "../../lib/news-desk/types";
import { ChatPanel } from "./ChatPanel";
import { HeadlineList } from "./HeadlineList";
import { IndicatorTable } from "./IndicatorTable";

type Tab = "All" | Topic | "Hidden";

const REGION_TABS: { region: Region; label: string }[] = [
  { region: "local", label: "Local" },
  { region: "international", label: "International" },
];

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
  const [region, setRegion] = useState<Region>("local");
  const [tab, setTab] = useState<Tab>("All");
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

  async function remove(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/news-desk/indicators/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(`Could not remove the indicator: ${body?.error ?? `status ${res.status}`}`);
        return;
      }
      setSnapshot((s) => (s ? { ...s, indicators: s.indicators.filter((v) => v.id !== id) } : s));
    } catch {
      setError("Could not remove the indicator: network error");
    }
  }

  function pinned(row: IndicatorValue) {
    setSnapshot((s) => (s ? { ...s, indicators: [...s.indicators.filter((v) => v.id !== row.id), row] } : s));
  }

  const failed = snapshot?.sourceErrors ?? [];
  // Drop items stay in the snapshot so they are not re-tagged on the next
  // refresh. They are kept out of All and listed under Hidden, so a real story
  // the model got wrong can still be found. Untagged items appear only under All.
  // Topic tabs count and filter within the selected region.
  const everything = snapshot?.headlines ?? [];
  const regionTabs = REGION_TABS.map((r) => ({
    ...r,
    count: everything.filter((h) => regionOf(h) === r.region && h.tag !== "Drop").length,
  }));
  const all = everything.filter((h) => regionOf(h) === region);
  const shown = all.filter((h) => h.tag !== "Drop");
  const hidden = all.filter((h) => h.tag === "Drop");
  const tabs: { label: Tab; count: number }[] = [
    { label: "All", count: shown.length },
    ...TOPICS.map((t) => ({ label: t, count: shown.filter((h) => h.tag === t).length })),
    { label: "Hidden", count: hidden.length },
  ];
  const visible =
    tab === "All" ? shown : tab === "Hidden" ? hidden : shown.filter((h) => h.tag === tab);

  function pickRegion(next: Region) {
    setRegion(next);
    setTab("All");
  }

  const regionLabel = REGION_TABS.find((r) => r.region === region)!.label;

  return (
    <div>
      <div className="grid grid-cols-12 gap-y-6 lg:gap-x-10">
        <div className="col-span-12 lg:col-span-8 lg:col-start-1 lg:row-start-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
            <div className="text-xs text-muted">
              {snapshot ? <span>Refreshed {formatAge(snapshot.refreshedAt, now)}</span> : <span>Never refreshed</span>}
              {failed.length > 0 && (
                <details className="mt-1">
                  <summary>
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
        </div>

        {/* Between the refresh bar and the headlines in the DOM, so narrow screens
            show it above the headlines (spec §4). On desktop it spans both rows
            and sticks with its centre at the middle of the viewport, so it is
            centred from the first paint and stays there while the headlines
            scroll. Nothing sits above it in its column, so when the headline
            column is too short for it to stick, the lift lands on empty space. */}
        <aside className="col-span-12 lg:sticky lg:top-1/2 lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1 lg:-translate-y-1/2 lg:self-start">
          <IndicatorTable indicators={snapshot?.indicators ?? []} now={now} onRemove={remove} />
        </aside>

        <div className="col-span-12 lg:col-span-8 lg:col-start-1 lg:row-start-2">
          {problem ? (
            <p className="text-sm text-muted">{problem}</p>
          ) : snapshot && snapshot.headlines.length > 0 ? (
            <>
              <div role="group" aria-label="Regions" className="mb-5 flex flex-wrap gap-8 border-b-2 border-rule-heavy">
                {regionTabs.map((r) => (
                  <button
                    key={r.region}
                    type="button"
                    aria-pressed={region === r.region}
                    onClick={() => pickRegion(r.region)}
                    className={`-mb-0.5 border-b-4 pb-3 font-display text-2xl leading-tight ${
                      region === r.region ? "border-accent text-fg" : "border-transparent text-muted"
                    }`}
                  >
                    {r.label} <span className="font-ui text-xs text-muted">{r.count}</span>
                  </button>
                ))}
              </div>
              <div role="group" aria-label="Topics" className="flex flex-wrap gap-4 border-b border-rule">
                {tabs.map(({ label, count }) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={tab === label}
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
                <p className="mt-6 text-sm text-muted">
                  {all.length === 0
                    ? `No ${regionLabel.toLowerCase()} headlines saved.`
                    : tab === "Hidden"
                      ? "No hidden headlines."
                      : tab === "All"
                        ? "Every saved headline is hidden."
                        : `No headlines tagged ${tab}.`}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">Nothing saved yet. Press Refresh to fetch headlines.</p>
          )}
        </div>
      </div>
      <ChatPanel onPinned={pinned} />
    </div>
  );
}
