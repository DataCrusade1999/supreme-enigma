// web/app/tools/money-planner/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CommandBar } from "../../../components/site/CommandBar";
import { ExpenseTable } from "../../../components/money-planner/ExpenseTable";
import { ResultPanel } from "../../../components/money-planner/ResultPanel";
import { formatInr } from "../../../components/money-planner/format";
import { computeAffordDate, monthlyNet, rollForward, type Plan } from "../../../lib/money-planner";
import { EMPTY_PLAN, loadPlan, savePlan } from "../../../lib/money-planner-storage";
import { todayIso } from "../../../lib/money-planner-dates";

function toNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

// An untouched form gets no result panel — not even "price must be more than
// zero", which reads as a complaint about a form nobody has filled in yet.
// Compared field by field rather than against EMPTY_PLAN by identity, because a
// plan loaded from storage is a different object with the same contents.
function isUntouched(plan: Plan): boolean {
  return (
    plan.balance === 0 &&
    plan.salary === 0 &&
    plan.payDay === 1 &&
    plan.expenses.length === 0 &&
    plan.target.name === "" &&
    plan.target.price === 0
  );
}

export default function MoneyPlannerPage() {
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  // Captured once per mount rather than read in render: the same date has to
  // back every calculation this session, and render must stay pure.
  const [today] = useState(() => todayIso());

  // Post-mount, never during render — reading localStorage while rendering
  // produces markup the server never sent, and React reports a mismatch.
  useEffect(() => {
    const saved = loadPlan();
    if (saved) {
      // Every nextDue in a plan left alone for a month is in the past. Roll
      // them to their next real occurrence so the form is not showing dates
      // that have gone by. This lands in state and, via the save effect
      // below, gets written back to storage so the rolled-forward dates are
      // what's there next time.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlan(rollForward(saved, today));
    }
  }, [today]);

  useEffect(() => {
    const handle = setTimeout(() => savePlan(plan), 300);
    return () => clearTimeout(handle);
  }, [plan]);

  const result = useMemo(() => computeAffordDate(plan, today), [plan, today]);
  const net = useMemo(() => monthlyNet(plan), [plan]);

  return (
    <div className="flex min-h-screen flex-col font-ui">
      {/* Same slim header as the other tool pages — they sit outside the
        * (site) route group, so there is no SiteHeader above them. */}
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg"
        >
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Ashutosh Pandey
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
          Tools / Money Planner
        </span>
      </header>

      <main className="flex flex-1 flex-col px-5 py-14 sm:px-10">
        <h1 className="font-display text-5xl leading-[0.95] sm:text-[5.25rem]">Money Planner</h1>
        <div className="mt-5 border-b-2 border-rule-heavy" />
        <p className="mt-[18px] max-w-[46ch] text-base leading-relaxed text-muted">
          What you have, what you earn, what you spend — and the date the thing you
          want is yours without leaving the next pay cycle short.
        </p>

        <div className="mt-12 grid gap-12 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-muted">
                Balance today
                <input
                  aria-label="Balance today"
                  type="number"
                  inputMode="numeric"
                  className="border border-line bg-transparent px-3 py-2 text-base tracking-normal text-fg"
                  value={Number.isNaN(plan.balance) ? "" : plan.balance}
                  onChange={(event) => setPlan({ ...plan, balance: toNumber(event.target.value) })}
                />
              </label>

              <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-muted">
                Monthly salary
                <input
                  aria-label="Monthly salary"
                  type="number"
                  inputMode="numeric"
                  className="border border-line bg-transparent px-3 py-2 text-base tracking-normal text-fg"
                  value={Number.isNaN(plan.salary) ? "" : plan.salary}
                  onChange={(event) => setPlan({ ...plan, salary: toNumber(event.target.value) })}
                />
              </label>

              <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-muted">
                Pay day
                <input
                  aria-label="Pay day"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={31}
                  className="border border-line bg-transparent px-3 py-2 text-base tracking-normal text-fg"
                  value={Number.isNaN(plan.payDay) ? "" : plan.payDay}
                  onChange={(event) => setPlan({ ...plan, payDay: toNumber(event.target.value) })}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-muted">
                What are you buying
                <input
                  aria-label="What are you buying"
                  className="border border-line bg-transparent px-3 py-2 text-base normal-case tracking-normal text-fg"
                  value={plan.target.name}
                  onChange={(event) =>
                    setPlan({ ...plan, target: { ...plan.target, name: event.target.value } })
                  }
                />
              </label>

              <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-muted">
                Price
                <input
                  aria-label="Price"
                  type="number"
                  inputMode="numeric"
                  className="border border-line bg-transparent px-3 py-2 text-base tracking-normal text-fg"
                  value={Number.isNaN(plan.target.price) ? "" : plan.target.price}
                  onChange={(event) =>
                    setPlan({
                      ...plan,
                      target: { ...plan.target, price: toNumber(event.target.value) },
                    })
                  }
                />
              </label>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-muted">Expenses</p>
              <div className="mt-4">
                <ExpenseTable
                  expenses={plan.expenses}
                  today={today}
                  onChange={(expenses) => setPlan({ ...plan, expenses })}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {isUntouched(plan) ? null : (
              <>
                <ResultPanel result={result} targetName={plan.target.name} today={today} />
                {/* The number that explains every answer above. */}
                {Number.isFinite(net) && (
                  <p className="text-sm text-muted">{formatInr(net)} spare a month, on average.</p>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <CommandBar />
    </div>
  );
}
