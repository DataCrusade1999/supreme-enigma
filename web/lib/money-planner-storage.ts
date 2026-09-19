import type { Plan } from "./money-planner";

// One key, one blob, versioned. A later shape change bumps v and this returns
// null for the old data rather than handing the page a half-read plan.
export const STORAGE_KEY = "money-planner";

export const EMPTY_PLAN: Plan = {
  v: 1,
  balance: 0,
  salary: 0,
  payDay: 1,
  expenses: [],
  target: { name: "", price: 0 },
};

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
    return plan.v === 1 && Array.isArray(plan.expenses) ? plan : null;
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
