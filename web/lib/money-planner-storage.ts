import type { Plan } from "./money-planner";

// One key, one blob, versioned. A later shape change bumps v and this returns
// null for the old data rather than handing the page a half-read plan.
export const STORAGE_KEY = "money-planner";

// Number fields start as NaN, which the inputs render as blank. A prefilled 0
// has to be deleted before typing, or "5000" becomes "05000"; a prefilled pay
// day of 1 turns a typed 5 into 15.
export const EMPTY_PLAN: Plan = {
  v: 1,
  balance: Number.NaN,
  salary: Number.NaN,
  payDay: Number.NaN,
  expenses: [],
  target: { name: "", price: Number.NaN },
};

// JSON has no NaN: a blank field is stored as null. Turn it back into NaN so
// the inputs render blank and validation reports it, rather than null reaching
// an input's value.
function reviveNumber(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

// No shipped writer leaves a name out, but a hand-edited or half-migrated blob
// can, and a missing name is not harmless: the page and the result panel call
// .trim() on it and the whole tool throws. Blank is what an unnamed field is.
function reviveName(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function revive(plan: Plan): Plan {
  return {
    ...plan,
    balance: reviveNumber(plan.balance),
    salary: reviveNumber(plan.salary),
    payDay: reviveNumber(plan.payDay),
    expenses: plan.expenses.map((expense) => ({
      ...expense,
      name: reviveName(expense.name),
      amount: reviveNumber(expense.amount),
      everyMonths: reviveNumber(expense.everyMonths),
    })),
    target: {
      ...plan.target,
      name: reviveName(plan.target?.name),
      price: reviveNumber(plan.target?.price),
    },
  };
}

// The empty plan as it was before fields started blank. The page used to save
// it on every visit, so most browsers hold it without anyone having typed a
// thing. Reading it as "nothing saved" is what makes the blank form show up
// there too.
function isOldEmptyPlan(plan: Plan): boolean {
  return (
    plan.balance === 0 &&
    plan.salary === 0 &&
    plan.payDay === 1 &&
    plan.expenses.length === 0 &&
    plan.target?.name === "" &&
    plan.target?.price === 0
  );
}

export function loadPlan(): Plan | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked outright; the tool still works, it just forgets.
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const plan = parsed as Plan;
    if (plan.v !== 1 || !Array.isArray(plan.expenses) || isOldEmptyPlan(plan)) {
      return null;
    }
    return revive(plan);
  } catch {
    return null;
  }
}

export function savePlan(plan: Plan): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // Full or blocked storage is not worth interrupting the calculation for.
  }
}
