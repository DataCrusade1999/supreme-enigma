import { describe, expect, it } from "vitest";
import { buildEvents, monthlyNet, rollForward, validatePlan, type Expense, type Plan } from "./money-planner";

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

describe("buildEvents", () => {
  it("emits a salary credit on each pay day in the window", () => {
    const events = buildEvents(plan({ payDay: 1, expenses: [] }), "2026-09-19", "2026-12-01");
    expect(events).toEqual([
      { date: "2026-10-01", label: "Salary", delta: 80_000, kind: "salary" },
      { date: "2026-11-01", label: "Salary", delta: 80_000, kind: "salary" },
      { date: "2026-12-01", label: "Salary", delta: 80_000, kind: "salary" },
    ]);
  });

  it("emits each expense as a negative delta on its own cadence", () => {
    const events = buildEvents(
      plan({
        payDay: 1,
        expenses: [expense({ name: "Wifi", amount: 1_800, everyMonths: 3, nextDue: "2026-10-04" })],
      }),
      "2026-09-19",
      "2027-01-05",
    );
    expect(events.filter((event) => event.kind === "expense")).toEqual([
      { date: "2026-10-04", label: "Wifi", delta: -1_800, kind: "expense" },
      { date: "2027-01-04", label: "Wifi", delta: -1_800, kind: "expense" },
    ]);
  });

  it("settles an expense before the salary when they share a date", () => {
    const events = buildEvents(
      plan({ payDay: 1, expenses: [expense({ name: "Rent", nextDue: "2026-10-01" })] }),
      "2026-09-19",
      "2026-10-01",
    );
    expect(events.map((event) => event.label)).toEqual(["Rent", "Salary"]);
  });

  it("includes events dated today — they are upcoming, not settled", () => {
    const events = buildEvents(
      plan({ payDay: 19, expenses: [expense({ name: "Rent", nextDue: "2026-09-19" })] }),
      "2026-09-19",
      "2026-09-19",
    );
    expect(events.map((event) => event.label)).toEqual(["Rent", "Salary"]);
  });

  it("does not replay the occurrences of a stale next-due", () => {
    // Opened again in September with an expense last set up for April.
    const events = buildEvents(
      plan({
        payDay: 1,
        expenses: [expense({ name: "Wifi", everyMonths: 3, nextDue: "2026-04-10" })],
      }),
      "2026-09-19",
      "2026-11-30",
    );
    expect(events.filter((event) => event.kind === "expense")).toEqual([
      { date: "2026-10-10", label: "Wifi", delta: -20_000, kind: "expense" },
    ]);
  });
});

describe("rollForward", () => {
  it("advances a stale next-due to the next real occurrence", () => {
    const rolled = rollForward(
      plan({ expenses: [expense({ everyMonths: 3, nextDue: "2026-04-10" })] }),
      "2026-09-19",
    );
    expect(rolled.expenses[0].nextDue).toBe("2026-10-10");
  });

  it("leaves a next-due that has not passed alone", () => {
    const rolled = rollForward(
      plan({ expenses: [expense({ everyMonths: 3, nextDue: "2026-10-10" })] }),
      "2026-09-19",
    );
    expect(rolled.expenses[0].nextDue).toBe("2026-10-10");
  });

  it("keeps a next-due falling today", () => {
    const rolled = rollForward(plan({ expenses: [expense({ nextDue: "2026-09-19" })] }), "2026-09-19");
    expect(rolled.expenses[0].nextDue).toBe("2026-09-19");
  });

  it("returns the plan untouched when it is invalid", () => {
    // A cadence of 0 would loop forever in the date helpers.
    const broken = plan({ expenses: [expense({ everyMonths: 0, nextDue: "2020-01-01" })] });
    expect(rollForward(broken, "2026-09-19")).toEqual(broken);
  });

  it("does not mutate the plan it was given", () => {
    const original = plan({ expenses: [expense({ everyMonths: 3, nextDue: "2026-04-10" })] });
    rollForward(original, "2026-09-19");
    expect(original.expenses[0].nextDue).toBe("2026-04-10");
  });
});
