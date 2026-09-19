import { describe, expect, it } from "vitest";
import { monthlyNet, validatePlan, type Expense, type Plan } from "./money-planner";

function expense(over: Partial<Expense> = {}): Expense {
  return { id: "e1", name: "Rent", amount: 20_000, everyMonths: 1, nextDue: "2026-10-01", ...over };
}

function plan(over: Partial<Plan> = {}): Plan {
  return {
    v: 1,
    balance: 50_000,
    salary: 80_000,
    payDay: 1,
    expenses: [expense()],
    target: { name: "Camera", price: 90_000 },
    ...over,
  };
}

describe("validatePlan", () => {
  it("accepts a plan that is fully filled in", () => {
    expect(validatePlan(plan())).toEqual([]);
  });

  it("accepts a plan with no expenses at all", () => {
    expect(validatePlan(plan({ expenses: [] }))).toEqual([]);
  });

  it.each([0, -1, 32, 1.5, Number.NaN])("rejects a pay day of %s", (payDay) => {
    expect(validatePlan(plan({ payDay }))).toContain(
      "Pay day must be a whole day between 1 and 31",
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects a balance of %s", (balance) => {
    expect(validatePlan(plan({ balance }))).toContain(
      "Balance must be a whole number of rupees, zero or more",
    );
  });

  it("rejects a price of zero — there is nothing to save towards", () => {
    expect(validatePlan(plan({ target: { name: "Camera", price: 0 } }))).toContain(
      "Price must be a whole number of rupees, more than zero",
    );
  });

  it.each([0, -3, 1.5, Number.NaN])("rejects a cadence of %s months", (everyMonths) => {
    // A cadence of zero would expand occurrences forever. This is reachable in
    // normal use: the field is empty for a keystroke while being retyped.
    expect(validatePlan(plan({ expenses: [expense({ everyMonths })] }))).toContain(
      "Rent: repeat must be a whole number of months, 1 or more",
    );
  });

  it("rejects a next-due that is not a date", () => {
    expect(validatePlan(plan({ expenses: [expense({ nextDue: "soon" })] }))).toContain(
      "Rent: next due must be a date",
    );
  });

  it("names an unnamed expense by position", () => {
    expect(validatePlan(plan({ expenses: [expense({ name: "", everyMonths: 0 })] }))).toContain(
      "Expense 1: repeat must be a whole number of months, 1 or more",
    );
  });

  it("reports every problem at once, not just the first", () => {
    expect(validatePlan(plan({ payDay: 0, balance: -5 }))).toHaveLength(2);
  });
});

describe("monthlyNet", () => {
  it("spreads each expense over its own cadence", () => {
    // 20,000 monthly + 1,800 quarterly (600/month) + 12,000 annual (1,000/month)
    const p = plan({
      salary: 80_000,
      expenses: [
        expense(),
        expense({ id: "e2", name: "Wifi", amount: 1_800, everyMonths: 3 }),
        expense({ id: "e3", name: "Insurance", amount: 12_000, everyMonths: 12 }),
      ],
    });
    expect(monthlyNet(p)).toBeCloseTo(58_400, 5);
  });

  it("is the salary when there are no expenses", () => {
    expect(monthlyNet(plan({ expenses: [] }))).toBe(80_000);
  });

  it("goes negative when the expenses outrun the salary", () => {
    expect(monthlyNet(plan({ salary: 10_000 }))).toBe(-10_000);
  });
});
