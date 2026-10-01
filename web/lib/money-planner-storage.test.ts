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

  it("starts every number field blank", () => {
    expect(EMPTY_PLAN.balance).toBeNaN();
    expect(EMPTY_PLAN.salary).toBeNaN();
    expect(EMPTY_PLAN.payDay).toBeNaN();
    expect(EMPTY_PLAN.target.price).toBeNaN();
  });

  it("round-trips blank fields as NaN rather than the null JSON stores", () => {
    savePlan({
      ...SAVED,
      balance: Number.NaN,
      expenses: [{ ...SAVED.expenses[0], amount: Number.NaN, everyMonths: Number.NaN }],
      target: { name: "Camera", price: Number.NaN },
    });
    const loaded = loadPlan() as Plan;
    expect(loaded.balance).toBeNaN();
    expect(loaded.salary).toBe(80_000);
    expect(loaded.target.price).toBeNaN();
    expect(loaded.expenses[0].amount).toBeNaN();
    expect(loaded.expenses[0].everyMonths).toBeNaN();
  });

  it("gives a missing target or expense name a blank one rather than undefined", () => {
    // Not written by the app itself; a hand-edited blob. Undefined names reach
    // .trim() in the page and crash it.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        balance: 100,
        salary: 100,
        payDay: 5,
        expenses: [{ id: "e1", amount: 10, everyMonths: 1, nextDue: "2026-10-01" }],
      }),
    );
    const loaded = loadPlan() as Plan;
    expect(loaded.target.name).toBe("");
    expect(loaded.target.price).toBeNaN();
    expect(loaded.expenses[0].name).toBe("");
    expect(loaded.balance).toBe(100);
  });

  it("treats the all-zero plan earlier versions saved on every visit as nothing saved", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, balance: 0, salary: 0, payDay: 1, expenses: [], target: { name: "", price: 0 } }),
    );
    expect(loadPlan()).toBeNull();
  });

  it("keeps a plan whose zeros were typed alongside something else", () => {
    savePlan({ ...SAVED, balance: 0 });
    expect(loadPlan()?.balance).toBe(0);
  });
});
