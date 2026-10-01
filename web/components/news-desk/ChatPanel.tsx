"use client";

import { useState, type FormEvent } from "react";
import type { AnswerEvent, AskEvent, ChartQuery } from "../../lib/news-desk/chat-types";
import { readNdjson } from "../../lib/news-desk/ndjson";
import type { IndicatorValue } from "../../lib/news-desk/types";
import { LineChart } from "./LineChart";

type Entry = { id: number; question: string; steps: string[]; answer?: AnswerEvent; error?: string; done: boolean };

export function ChatPanel({ onPinned }: { onPinned: (row: IndicatorValue) => void }) {
  const [open, setOpen] = useState(false);
  // Kept while the tab is open so earlier answers can be scrolled back to and
  // pinned; none of it is sent with the next question (spec §7.1).
  const [entries, setEntries] = useState<Entry[]>([]);
  const [question, setQuestion] = useState("");
  const busy = entries.some((e) => !e.done);

  function update(id: number, change: (e: Entry) => Entry) {
    setEntries((all) => all.map((e) => (e.id === id ? change(e) : e)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    const id = Date.now();
    setEntries((all) => [...all, { id, question: q, steps: [], done: false }]);
    setQuestion("");
    try {
      const res = await fetch("/api/news-desk/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        update(id, (e) => ({ ...e, error: `Could not ask: ${body?.error ?? `status ${res.status}`}` }));
        return;
      }
      await readNdjson(res.body, (raw) => {
        const ev = raw as AskEvent;
        if (ev.type === "step") update(id, (e) => ({ ...e, steps: [...e.steps, ev.label] }));
        else if (ev.type === "answer") update(id, (e) => ({ ...e, answer: ev }));
        else if (ev.type === "error") update(id, (e) => ({ ...e, error: ev.message }));
      });
    } catch {
      update(id, (e) => ({ ...e, error: e.error ?? "The connection dropped before the answer arrived." }));
    } finally {
      update(id, (e) => ({ ...e, done: true, error: e.error ?? (e.answer ? undefined : "The answer did not arrive.") }));
    }
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="fixed right-6 bottom-6 z-20 rounded-md border border-rule bg-bg px-4 py-2 text-sm text-fg shadow"
      >
        Ask MoSPI
      </button>
      {open && (
        <section
          aria-label="Ask MoSPI"
          className="fixed right-4 bottom-20 z-20 flex max-h-[70vh] w-[min(28rem,calc(100vw-2rem))] flex-col border border-rule bg-bg shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-rule px-4 py-2">
            <h2 className="text-sm font-semibold text-fg">Ask MoSPI</h2>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted">
              Close
            </button>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-3">
            {entries.length === 0 && (
              <p className="text-sm text-muted">Ask about Indian official statistics: prices, output, jobs, national accounts.</p>
            )}
            {entries.map((e) => (
              <article key={e.id}>
                <p className="text-sm font-medium text-fg">{e.question}</p>
                {e.steps.length > 0 && (
                  <ul className="mt-1 text-xs text-muted">
                    {e.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
                {e.answer && (
                  <>
                    <p className="mt-2 text-sm whitespace-pre-wrap text-fg">{e.answer.text}</p>
                    {e.answer.chart && <LineChart {...e.answer.chart} />}
                    {e.answer.pinnable && e.answer.query && <PinForm query={e.answer.query} onPinned={onPinned} />}
                  </>
                )}
                {e.error && <p className="mt-2 text-sm text-accent">{e.error}</p>}
              </article>
            ))}
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t border-rule px-4 py-3">
            <input
              aria-label="Question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Each question is answered on its own."
              maxLength={500}
              className="min-w-0 flex-1 rounded-md border border-rule bg-bg px-2 py-1.5 text-sm text-fg"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-rule px-3 py-1.5 text-sm text-fg disabled:opacity-50"
            >
              Ask
            </button>
          </form>
        </section>
      )}
    </>
  );
}

function PinForm({ query, onPinned }: { query: ChartQuery; onPinned: (row: IndicatorValue) => void }) {
  const [label, setLabel] = useState(query.title);
  const [status, setStatus] = useState<{ saving: boolean; message?: string; done?: boolean }>({ saving: false });

  async function pin(event: FormEvent) {
    event.preventDefault();
    setStatus({ saving: true });
    const { title: _title, ...rest } = query;
    void _title;
    try {
      const res = await fetch("/api/news-desk/indicators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), ...rest }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus({ saving: false, message: `Could not pin: ${body?.error ?? `status ${res.status}`}` });
        return;
      }
      onPinned(body.indicator as IndicatorValue);
      setStatus({ saving: false, done: true, message: "Pinned. It fills in on the next Refresh." });
    } catch {
      setStatus({ saving: false, message: "Could not pin: network error" });
    }
  }

  if (status.done) return <p className="mt-2 text-xs text-muted">{status.message}</p>;
  return (
    <form onSubmit={pin} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        aria-label="Indicator name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={80}
        className="min-w-0 flex-1 rounded-md border border-rule bg-bg px-2 py-1 text-xs text-fg"
      />
      <button
        type="submit"
        disabled={status.saving || !label.trim()}
        className="rounded-md border border-rule px-2 py-1 text-xs text-fg disabled:opacity-50"
      >
        Pin
      </button>
      {status.message && <p className="w-full text-xs text-accent">{status.message}</p>}
    </form>
  );
}
