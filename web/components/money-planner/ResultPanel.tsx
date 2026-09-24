"use client";

import { useState } from "react";
import type { AffordResult } from "../../lib/money-planner";
import type { IsoDate } from "../../lib/money-planner-dates";
import { formatAway, formatInr, formatLongDate, formatShortDate } from "./format";

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
            : result.reason === "break-even"
              ? "Not on this budget — it breaks even, with nothing left over to save."
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
        // Scrolls inside the panel: ten years of monthly events is hundreds of
        // rows, and the answer above should stay in reach. The header sticks to
        // the top of this box, not the page.
        <div className="mt-4 max-h-[28rem] overflow-auto border-t border-line">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">How the balance reaches the price, event by event</caption>
            <thead className="sticky top-0 bg-bg">
              <tr className="text-left text-[0.6875rem] uppercase tracking-[0.14em] text-muted">
                <th scope="col" className="border-b border-line py-2 pr-3 sm:pr-4 font-normal">
                  Date
                </th>
                <th scope="col" className="border-b border-line py-2 pr-3 sm:pr-4 font-normal">
                  Item
                </th>
                <th scope="col" className="border-b border-line py-2 pr-3 sm:pr-4 text-right font-normal">
                  Amount
                </th>
                <th scope="col" className="border-b border-line py-2 text-right font-normal">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {result.timeline.map((event, index) => {
                // Several events share a day (every bill due on the 1st). The
                // date is shown once, on the first of them, with a rule above
                // it; the rest keep it for screen readers only.
                const firstOfDay = index === 0 || result.timeline[index - 1].date !== event.date;
                return (
                  <tr
                    key={`${event.date}-${event.label}-${index}`}
                    className={firstOfDay && index > 0 ? "border-t border-line" : undefined}
                  >
                    <td className="py-1.5 pr-3 align-top tabular-nums text-muted sm:whitespace-nowrap sm:pr-4">
                      <span className={firstOfDay ? undefined : "sr-only"}>
                        {formatShortDate(event.date)}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 align-top sm:pr-4">{event.label}</td>
                    <td
                      className={`whitespace-nowrap py-1.5 pr-3 text-right align-top tabular-nums sm:pr-4 ${
                        event.delta < 0 ? "text-muted" : "text-accent"
                      }`}
                    >
                      {formatInr(event.delta)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right align-top tabular-nums">
                      {formatInr(event.balanceAfter)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
