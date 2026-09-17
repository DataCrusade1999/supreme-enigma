"use client";

import { useState } from "react";

export function SendButton({ slug }: { slug: string }) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    if (!window.confirm("Send this issue to all subscribers now? This cannot be undone.")) {
      return;
    }
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/newsletter/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json().catch(() => ({ error: "Unknown error" }));
      if (res.ok) {
        setStatus("sent");
      } else {
        setError(data.error ?? "Send failed");
        setStatus("error");
      }
    } catch (err) {
      // A rejected fetch (offline, DNS failure, connection dropped) would
      // otherwise escape the handler and strand the button on "Sending…".
      setError(err instanceof Error ? err.message : "Network error");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
        Sent
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleSend}
        disabled={status === "sending"}
        className="min-h-11 shrink-0 bg-fg px-5 text-sm font-semibold tracking-tight text-bg transition-colors duration-200 ease-out hover:bg-accent disabled:opacity-50 motion-reduce:transition-none"
      >
        {status === "sending" ? "Sending…" : "Send"}
      </button>
      {status === "error" && (
        <p role="alert" className="max-w-[220px] text-right text-[0.8125rem] text-peak">
          {error}
        </p>
      )}
    </div>
  );
}
