import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_PLAN, STORAGE_KEY, loadPlan, savePlan } from "./money-planner-storage";
import type { Plan } from "./money-planner";

const SAVED: Plan = {
  v: 1,
  balance: 50_000,
  salary: 80_000,
  payDay: 1,
  expenses: [{ id: "e1", name: "Rent", amount: 20_000, everyMonths: 1, nextDue: "2026-10-01" }],
  target: { name: "Camera", price: 90_000 },
};

describe("money planner storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a plan", () => {
    savePlan(SAVED);
    expect(loadPlan()).toEqual(SAVED);
  });

  it("returns null when nothing has been saved", () => {
    expect(loadPlan()).toBeNull();
  });

  it("returns null rather than throwing on unparseable data", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadPlan()).toBeNull();
  });

  it("returns null on a plan from a future version", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...SAVED, v: 2 }));
    expect(loadPlan()).toBeNull();
  });

  it("returns null on JSON that is not a plan", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(loadPlan()).toBeNull();
  });

  it("starts from an empty plan that is safe to render", () => {
    expect(EMPTY_PLAN.expenses).toEqual([]);
    expect(EMPTY_PLAN.v).toBe(1);
  });
});
