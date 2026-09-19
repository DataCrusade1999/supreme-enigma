import {
  compareIso,
  dueDatesBetween,
  nextOccurrenceOnOrAfter,
  payDatesBetween,
  type IsoDate,
} from "./money-planner-dates";

export type Money = number;

export type Expense = {
  id: string;
  name: string;
  amount: Money;
  everyMonths: number;
  nextDue: IsoDate;
};

export type Plan = {
  v: 1;
  balance: Money;
  salary: Money;
  payDay: number;
  expenses: Expense[];
  target: { name: string; price: Money };
};

function isWholeAtLeast(value: number, min: number): boolean {
  return Number.isInteger(value) && value >= min;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validatePlan(plan: Plan): string[] {
  const problems: string[] = [];

  if (!isWholeAtLeast(plan.balance, 0)) {
    problems.push("Balance must be a whole number of rupees, zero or more");
  }
  if (!isWholeAtLeast(plan.salary, 0)) {
    problems.push("Salary must be a whole number of rupees, zero or more");
  }
  if (!isWholeAtLeast(plan.payDay, 1) || plan.payDay > 31) {
    problems.push("Pay day must be a whole day between 1 and 31");
  }
  if (!isWholeAtLeast(plan.target.price, 1)) {
    problems.push("Price must be a whole number of rupees, more than zero");
  }

  plan.expenses.forEach((expense, index) => {
    const label = expense.name.trim() || `Expense ${index + 1}`;
    if (!isWholeAtLeast(expense.amount, 0)) {
      problems.push(`${label}: amount must be a whole number of rupees, zero or more`);
    }
    // Guards the occurrence expansion: everyMonths of 0 never advances.
    if (!isWholeAtLeast(expense.everyMonths, 1)) {
      problems.push(`${label}: repeat must be a whole number of months, 1 or more`);
    }
    if (!ISO_DATE.test(expense.nextDue)) {
      problems.push(`${label}: next due must be a date`);
    }
  });

  return problems;
}

// The average, not a simulated figure: what the page shows beside the answer to
// explain it. Fractional by nature — a quarterly bill is not a whole number of
// rupees per month — so it is rounded at the point of display, never here.
export function monthlyNet(plan: Plan): number {
  const load = plan.expenses.reduce(
    (sum, expense) => sum + expense.amount / expense.everyMonths,
    0,
  );
  return plan.salary - load;
}

export type RawEvent = {
  date: IsoDate;
  label: string;
  delta: Money;
  kind: "expense" | "salary";
};

export function buildEvents(plan: Plan, from: IsoDate, until: IsoDate): RawEvent[] {
  const events: RawEvent[] = [];

  for (const expense of plan.expenses) {
    for (const date of dueDatesBetween(expense.nextDue, expense.everyMonths, from, until)) {
      events.push({
        date,
        label: expense.name.trim() || "Expense",
        delta: -expense.amount,
        kind: "expense",
      });
    }
  }

  for (const date of payDatesBetween(plan.payDay, from, until)) {
    events.push({ date, label: "Salary", delta: plan.salary, kind: "salary" });
  }

  // Expenses before salary on a shared date: the pessimistic order, so the
  // answer is never a date that a same-day debit would have broken.
  return events.sort((a, b) => {
    const byDate = compareIso(a.date, b.date);
    if (byDate !== 0) {
      return byDate;
    }
    return a.kind === b.kind ? 0 : a.kind === "expense" ? -1 : 1;
  });
}

// A plan reopened weeks later has every nextDue in the past. Those occurrences
// are gone and their money with them — already missing from the balance the
// user typed — so they roll forward rather than replay.
export function rollForward(plan: Plan, today: IsoDate): Plan {
  if (validatePlan(plan).length > 0) {
    return plan;
  }
  return {
    ...plan,
    expenses: plan.expenses.map((expense) => ({
      ...expense,
      nextDue: nextOccurrenceOnOrAfter(expense.nextDue, expense.everyMonths, today),
    })),
  };
}
