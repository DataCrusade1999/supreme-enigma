"use client";

import type { Expense } from "../../lib/money-planner";
import type { IsoDate } from "../../lib/money-planner-dates";

// A cleared number input reads as "". Number("") is 0, which is a valid amount
// and a valid-looking plan, so the answer would quietly change mid-edit. NaN
// fails validation instead, and the page shows what is wrong.
function toNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

export function ExpenseTable({
  expenses,
  today,
  onChange,
}: {
  expenses: Expense[];
  today: IsoDate;
  onChange: (next: Expense[]) => void;
}) {
  function replace(index: number, patch: Partial<Expense>) {
    onChange(expenses.map((expense, i) => (i === index ? { ...expense, ...patch } : expense)));
  }

  return (
    <div className="flex flex-col gap-4">
      {expenses.length === 0 ? (
        <p className="text-sm text-muted">No expenses yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {expenses.map((expense, index) => (
            <li key={expense.id} className="grid grid-cols-2 gap-3 border-b border-line pb-4">
              <label className="col-span-2 flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-muted">
                Name
                <input
                  aria-label={`Expense ${index + 1} name`}
                  className="border border-line bg-transparent px-3 py-2 text-base normal-case tracking-normal text-fg"
                  value={expense.name}
                  onChange={(event) => replace(index, { name: event.target.value })}
                />
              </label>

              <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-muted">
                Amount
                <input
                  aria-label={`Expense ${index + 1} amount`}
                  type="number"
                  inputMode="numeric"
                  className="border border-line bg-transparent px-3 py-2 text-base tracking-normal text-fg"
                  value={Number.isNaN(expense.amount) ? "" : expense.amount}
                  onChange={(event) => replace(index, { amount: toNumber(event.target.value) })}
                />
              </label>

              <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-muted">
                Repeats every … months
                <input
                  aria-label={`Expense ${index + 1} repeats every`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  className="border border-line bg-transparent px-3 py-2 text-base tracking-normal text-fg"
                  value={Number.isNaN(expense.everyMonths) ? "" : expense.everyMonths}
                  onChange={(event) => replace(index, { everyMonths: toNumber(event.target.value) })}
                />
              </label>

              <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-muted">
                Next due
                <input
                  aria-label={`Expense ${index + 1} next due`}
                  type="date"
                  className="border border-line bg-transparent px-3 py-2 text-base tracking-normal text-fg"
                  value={expense.nextDue}
                  onChange={(event) => replace(index, { nextDue: event.target.value })}
                />
              </label>

              <button
                type="button"
                aria-label={`Remove ${expense.name.trim() || `expense ${index + 1}`}`}
                className="justify-self-start text-[0.6875rem] uppercase tracking-[0.16em] text-muted hover:text-accent"
                onClick={() => onChange(expenses.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="self-start border border-line px-4 py-2 text-[0.6875rem] uppercase tracking-[0.16em] text-fg hover:border-accent hover:text-accent"
        onClick={() =>
          onChange([
            ...expenses,
            { id: crypto.randomUUID(), name: "", amount: 0, everyMonths: 1, nextDue: today },
          ])
        }
      >
        Add expense
      </button>
    </div>
  );
}
