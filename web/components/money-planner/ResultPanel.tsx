"use client";

import { useState } from "react";
import type { AffordResult } from "../../lib/money-planner";
import type { IsoDate } from "../../lib/money-planner-dates";
import { formatAway, formatInr, formatLongDate } from "./format";

export function ResultPanel({
  result,
  targetName,
  today,
}: {
  result: AffordResult;
  targetName: string;
  today: IsoDate;
}) {
  const [showTimeline, setShowTimeline] = useState(false);
  const thing = targetName.trim() || "it";

  if (result.kind === "invalid") {
    return (
      <div className="border border-line p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Not ready</p>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm text-fg">
          {result.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (result.kind === "already") {
    return (
      <div className="border border-line p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">The answer</p>
        <p className="mt-3 font-display text-4xl leading-tight">You can buy {thing} today.</p>
      </div>
    );
  }

  if (result.kind === "unreachable") {
    return (
      <div className="border border-line p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">The answer</p>
        <p className="mt-3 font-display text-4xl leading-tight">
          {result.reason === "negative"
            ? `Not on this budget — you are ${formatInr(Math.abs(result.monthlyNet))} short each month.`
            : `More than ten years away at ${formatInr(result.monthlyNet)} spare a month.`}
        </p>
      </div>
    );
  }

  return (
    <div className="border border-line p-6">
      <p className="text-xs uppercase tracking-[0.14em] text-muted">You can buy {thing} on</p>
      <p className="mt-3 font-display text-5xl leading-[0.95]">{formatLongDate(result.date)}</p>
      <p className="mt-3 text-sm text-muted">
        {formatAway(today, result.date)} — {formatInr(result.balanceThen)} in hand that day.
      </p>

      <button
        type="button"
        className="mt-6 text-[0.6875rem] uppercase tracking-[0.16em] text-muted hover:text-accent"
        onClick={() => setShowTimeline((open) => !open)}
      >
        {showTimeline ? "Hide how this adds up" : "How this adds up"}
      </button>

      {showTimeline ? (
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {result.timeline.map((event, index) => (
            <li
              key={`${event.date}-${event.label}-${index}`}
              className="flex justify-between gap-4"
            >
              <span className="text-muted">{formatLongDate(event.date)}</span>
              <span>{event.label}</span>
              <span className={event.delta < 0 ? "text-muted" : "text-accent"}>
                {formatInr(event.delta)}
              </span>
              <span className="text-muted">{formatInr(event.balanceAfter)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
