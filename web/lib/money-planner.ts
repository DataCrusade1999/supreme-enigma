import type { IsoDate } from "./money-planner-dates";

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
