# Money Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gated tool at `/tools/money-planner` that names the exact date a purchase becomes affordable, given a balance, a monthly salary, and itemized expenses that recur on their own cadences.

**Architecture:** A pure calculation library expands salary and expenses into dated events, walks them in date order carrying a running balance, and returns the first date the purchase leaves enough behind to cover the rest of the pay cycle. A client page collects the inputs, keeps them in `localStorage`, and recomputes on every keystroke. No API route, no server state.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest + Testing Library, Playwright, Storybook 10.

**Spec:** `docs/superpowers/specs/2026-09-19-money-planner-design.md`

## Global Constraints

Copied from the spec. Every task's requirements include these.

- **Money is whole rupees**, stored as integers. No floats, no paise. The one exception is `monthlyNet`, which is an average and may be fractional; it is rounded only for display.
- **Dates are date-only ISO strings** (`"YYYY-MM-DD"`). No time-of-day, no UTC/local mixing. `money-planner-dates.ts` does integer arithmetic on year/month/day and is the only module that reads the clock — in exactly one function, `todayIso()`. `Date.UTC` arithmetic on a year/month/day already in hand is not a clock read and is allowed; `new Date()` anywhere else is not.
- **`today` is always a parameter.** No `Date.now()` inside the calculation, the same convention `web/lib/auth.ts` uses for `now`.
- **Ordering:** on a shared date, expenses settle before salary.
- **Checkpoints:** the affordability test runs once per distinct date, after every event on that date has settled — never between two events sharing a date. It also runs once before any event, which is what produces `already`.
- **Events dated today are upcoming, not settled.** The balance the user typed is what is in the account right now.
- **Affordability:** a checkpoint passes when `balance − price ≥` the sum of expenses falling after that checkpoint and before the next salary credit (expenses sharing the salary's date are included, because they settle first).
- **Storage:** one `localStorage` key, one JSON blob, `v: 1`.
- **Horizon:** 10 years.
- **Registration:** `href: "/tools/money-planner"`, `kind: "Money"`, name `"Money Planner"`. No `GATED_PREFIXES` change — `/tools` is gated as a whole namespace.
- **Every new component under `web/components/` needs a `.stories.tsx`** alongside it. The `chromatic` job gates `release`.
- **`CHANGELOG.md`** gets an entry under `## [Unreleased]` in the implementation PR.
- **No mannered prose** in copy, comments, commit messages or the PR body.

---

### Task 0: Issue, label, branch, docs PR

The repo files the issue before the work and lands spec + plan as their own documentation PR (this is what #210 did for the Storybook work: body `Refs #209`, issue left open until the code lands).

**Files:**
- Already written: `docs/superpowers/specs/2026-09-19-money-planner-design.md`
- Already written: `docs/superpowers/plans/2026-09-19-money-planner.md`

- [ ] **Step 1: Create the label**

`area: finance` does not exist. The existing area labels are `bgm-looper`, `bgm-extractor`, `portfolio`, `infra`, `testing`; none covers a personal-finance tool.

```bash
gh label create "area: finance" --description "Money and budgeting tools" --color 5319E7
```

- [ ] **Step 2: File the issue**

```bash
gh issue create \
  --title "Money Planner: tell me the date I can afford something" \
  --label "area: finance" --label "priority: medium" \
  --body "Given a balance, a monthly salary and itemized expenses that recur on their own cadences (monthly rent, quarterly wifi, annual insurance), name the exact date a given purchase becomes affordable without leaving the next pay cycle short.

A month count is not enough: a large irregular expense landing near the target moves the date, and only a dated simulation catches that.

Design: docs/superpowers/specs/2026-09-19-money-planner-design.md"
```

Note the issue number as `#N` — it is referenced twice below.

- [ ] **Step 3: Branch off dev**

```bash
git checkout dev && git pull --ff-only origin dev && git checkout -b docs/money-planner-design
```

- [ ] **Step 4: Commit the docs**

```bash
git add docs/superpowers/specs/2026-09-19-money-planner-design.md docs/superpowers/plans/2026-09-19-money-planner.md
git commit -m "docs: design and plan for the Money Planner tool

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

- [ ] **Step 5: Open the docs PR**

Body opens with `Refs #N` — not `Closes #N`. The issue stays open until the implementation lands.

```bash
git push -u origin docs/money-planner-design
gh pr create --base dev --title "docs: Money Planner design and implementation plan" --body "Refs #N. Documentation only — no implementation.

- docs/superpowers/specs/2026-09-19-money-planner-design.md
- docs/superpowers/plans/2026-09-19-money-planner.md"
```

Follow the root `CLAUDE.md` merge sequence for this PR: all four CI jobs green, the release-readiness verdict `change approved`, both bots' inline comments read and triaged, threads resolved, then `--squash --delete-branch`. Implementation continues on a fresh branch off `dev`.

---

### Task 1: Calendar arithmetic

**Files:**
- Create: `web/lib/money-planner-dates.ts`
- Test: `web/lib/money-planner-dates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type IsoDate = string`
  - `lastDayOfMonth(year: number, month: number): number` — `month` is 1–12.
  - `makeIso(year: number, month: number, day: number): IsoDate` — `day` clamped to the month's length.
  - `parseIso(date: IsoDate): { year: number; month: number; day: number }`
  - `compareIso(a: IsoDate, b: IsoDate): number`
  - `nextOccurrenceOnOrAfter(anchor: IsoDate, everyMonths: number, from: IsoDate): IsoDate`
  - `dueDatesBetween(anchor: IsoDate, everyMonths: number, from: IsoDate, until: IsoDate): IsoDate[]`
  - `payDatesBetween(payDay: number, from: IsoDate, until: IsoDate): IsoDate[]`
  - `addYears(date: IsoDate, years: number): IsoDate`
  - `todayIso(now?: Date): IsoDate`

Every recurrence is computed from the original anchor by absolute month arithmetic. Never by repeatedly adding one cycle to the previous result: from 31 January that drifts to 28 February, then 28 March, and the expense silently moves.

- [ ] **Step 0: Cut the implementation branch**

Task 0's docs branch has been merged and deleted. Everything from here lands on one implementation branch.

```bash
git checkout dev && git pull --ff-only origin dev && git checkout -b feat/money-planner
```

- [ ] **Step 1: Write the failing tests**

```ts
// web/lib/money-planner-dates.test.ts
import { describe, expect, it } from "vitest";
import {
  addYears,
  compareIso,
  dueDatesBetween,
  lastDayOfMonth,
  makeIso,
  nextOccurrenceOnOrAfter,
  parseIso,
  payDatesBetween,
  todayIso,
} from "./money-planner-dates";

describe("lastDayOfMonth", () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2028, 2, 29],
    [2000, 2, 29],
    [1900, 2, 28],
    [2026, 4, 30],
  ])("%i-%i has %i days", (year, month, days) => {
    expect(lastDayOfMonth(year, month)).toBe(days);
  });
});

describe("makeIso", () => {
  it("pads to YYYY-MM-DD", () => {
    expect(makeIso(2026, 3, 4)).toBe("2026-03-04");
  });

  it("clamps a day past the end of the month", () => {
    expect(makeIso(2026, 2, 31)).toBe("2026-02-28");
    expect(makeIso(2026, 4, 31)).toBe("2026-04-30");
  });
});

describe("parseIso", () => {
  it("reads the parts as numbers", () => {
    expect(parseIso("2026-03-04")).toEqual({ year: 2026, month: 3, day: 4 });
  });
});

describe("compareIso", () => {
  it("orders lexically, which is chronological for this format", () => {
    expect(compareIso("2026-03-04", "2026-03-05")).toBeLessThan(0);
    expect(compareIso("2027-01-01", "2026-12-31")).toBeGreaterThan(0);
    expect(compareIso("2026-03-04", "2026-03-04")).toBe(0);
  });
});

describe("nextOccurrenceOnOrAfter", () => {
  it("returns the anchor itself when it has not passed", () => {
    expect(nextOccurrenceOnOrAfter("2026-10-04", 3, "2026-09-19")).toBe("2026-10-04");
    expect(nextOccurrenceOnOrAfter("2026-09-19", 3, "2026-09-19")).toBe("2026-09-19");
  });

  it("rolls a stale anchor forward by whole cycles", () => {
    // A quarterly expense last set up for April, opened again in September.
    expect(nextOccurrenceOnOrAfter("2026-04-10", 3, "2026-09-19")).toBe("2026-10-10");
  });

  it("anchors every occurrence to the original day, without drift", () => {
    // Jan 31 quarterly: April has 30 days, but July must return to the 31st.
    expect(nextOccurrenceOnOrAfter("2026-01-31", 3, "2026-04-01")).toBe("2026-04-30");
    expect(nextOccurrenceOnOrAfter("2026-01-31", 3, "2026-05-01")).toBe("2026-07-31");
  });
});

describe("dueDatesBetween", () => {
  it("lists a quarterly expense across a year boundary", () => {
    expect(dueDatesBetween("2026-11-04", 3, "2026-09-19", "2027-06-30")).toEqual([
      "2026-11-04",
      "2027-02-04",
      "2027-05-04",
    ]);
  });

  it("includes an occurrence falling on the first day of the window", () => {
    expect(dueDatesBetween("2026-09-19", 1, "2026-09-19", "2026-11-30")).toEqual([
      "2026-09-19",
      "2026-10-19",
      "2026-11-19",
    ]);
  });

  it("skips the occurrences that have already gone by", () => {
    expect(dueDatesBetween("2026-01-04", 3, "2026-09-19", "2027-01-31")).toEqual([
      "2026-10-04",
      "2027-01-04",
    ]);
  });

  it("returns nothing when the first occurrence is past the window", () => {
    expect(dueDatesBetween("2027-01-04", 12, "2026-09-19", "2026-12-31")).toEqual([]);
  });
});

describe("payDatesBetween", () => {
  it("lists a pay day every month", () => {
    expect(payDatesBetween(4, "2026-09-19", "2027-01-10")).toEqual([
      "2026-10-04",
      "2026-11-04",
      "2026-12-04",
      "2027-01-04",
    ]);
  });

  it("clamps a 31st pay day to the end of short months and comes back", () => {
    expect(payDatesBetween(31, "2026-01-01", "2026-05-01")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("clamps a 29th pay day in a non-leap February", () => {
    expect(payDatesBetween(29, "2026-02-01", "2026-03-01")).toEqual(["2026-02-28"]);
  });

  it("includes a pay day falling on the window's first day", () => {
    expect(payDatesBetween(19, "2026-09-19", "2026-10-01")).toEqual(["2026-09-19"]);
  });
});

describe("addYears", () => {
  it("moves the horizon out by whole years", () => {
    expect(addYears("2026-09-19", 10)).toBe("2036-09-19");
  });

  it("clamps 29 February", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
  });
});

describe("todayIso", () => {
  it("reads the local calendar date, not the UTC one", () => {
    // 23:30 local on the 19th is already the 20th in UTC. The user's calendar
    // is the one that matters.
    const late = new Date(2026, 8, 19, 23, 30);
    expect(todayIso(late)).toBe("2026-09-19");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/money-planner-dates.test.ts`
Expected: FAIL — `Failed to resolve import "./money-planner-dates"`.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/money-planner-dates.ts

// Calendar arithmetic on date-only ISO strings, done with integers rather than
// Date objects. A Date built from "2026-09-19" is midnight UTC, and reading it
// back through local getters shifts the day in any zone behind UTC — which is
// every run on this machine (IST) and none in CI (UTC). todayIso is the only
// function here that touches Date, and it only ever reads local getters.

export type IsoDate = string;

export function lastDayOfMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) {
    return 29;
  }
  return lengths[month - 1];
}

export function makeIso(year: number, month: number, day: number): IsoDate {
  const clamped = Math.min(day, lastDayOfMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
    clamped,
  ).padStart(2, "0")}`;
}

export function parseIso(date: IsoDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Every occurrence is computed from the anchor's own month index, never by
// stepping from the previous result: 31 January stepped one month at a time
// lands on 28 February and stays there, so the expense drifts three days
// earlier for the rest of the year.
function shifted(anchor: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseIso(anchor);
  const index = month - 1 + months;
  return makeIso(year + Math.floor(index / 12), (((index % 12) + 12) % 12) + 1, day);
}

export function nextOccurrenceOnOrAfter(
  anchor: IsoDate,
  everyMonths: number,
  from: IsoDate,
): IsoDate {
  const a = parseIso(anchor);
  const f = parseIso(from);
  const gap = (f.year - a.year) * 12 + (f.month - a.month);
  let k = Math.max(0, Math.floor(gap / everyMonths));
  // The month estimate can be one cycle short when the day-of-month has not
  // arrived yet; step, never guess twice.
  while (compareIso(shifted(anchor, k * everyMonths), from) < 0) {
    k += 1;
  }
  return shifted(anchor, k * everyMonths);
}

export function dueDatesBetween(
  anchor: IsoDate,
  everyMonths: number,
  from: IsoDate,
  until: IsoDate,
): IsoDate[] {
  const first = nextOccurrenceOnOrAfter(anchor, everyMonths, from);
  const a = parseIso(anchor);
  const f = parseIso(first);
  let k = Math.round(((f.year - a.year) * 12 + (f.month - a.month)) / everyMonths);
  const out: IsoDate[] = [];
  for (let date = first; compareIso(date, until) <= 0; ) {
    out.push(date);
    k += 1;
    date = shifted(anchor, k * everyMonths);
  }
  return out;
}

export function payDatesBetween(payDay: number, from: IsoDate, until: IsoDate): IsoDate[] {
  const { year, month } = parseIso(from);
  const out: IsoDate[] = [];
  for (let i = 0; ; i += 1) {
    const index = month - 1 + i;
    const date = makeIso(year + Math.floor(index / 12), (index % 12) + 1, payDay);
    if (compareIso(date, until) > 0) {
      break;
    }
    if (compareIso(date, from) >= 0) {
      out.push(date);
    }
  }
  return out;
}

export function addYears(date: IsoDate, years: number): IsoDate {
  const { year, month, day } = parseIso(date);
  return makeIso(year + years, month, day);
}

export function todayIso(now: Date = new Date()): IsoDate {
  return makeIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/money-planner-dates.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add web/lib/money-planner-dates.ts web/lib/money-planner-dates.test.ts
git commit -m "feat(money-planner): calendar arithmetic on date-only ISO strings

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 2: Plan shape, validation, monthly net

**Files:**
- Create: `web/lib/money-planner.ts`
- Test: `web/lib/money-planner.test.ts`

**Interfaces:**
- Consumes: the `IsoDate` type from Task 1.
- Produces:
  - `type Money = number`
  - `type Expense = { id: string; name: string; amount: Money; everyMonths: number; nextDue: IsoDate }`
  - `type Plan = { v: 1; balance: Money; salary: Money; payDay: number; expenses: Expense[]; target: { name: string; price: Money } }`
  - `validatePlan(plan: Plan): string[]` — empty array means valid.
  - `monthlyNet(plan: Plan): number` — `salary − Σ(amount ÷ everyMonths)`, may be fractional.

Validation is not defensive padding. `everyMonths` is briefly `0` or `NaN` while the cadence field is being typed, and the page recomputes on every keystroke: a cadence of zero would expand occurrences forever and hang the tab.

- [ ] **Step 1: Write the failing tests**

```ts
// web/lib/money-planner.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/money-planner.test.ts`
Expected: FAIL — `Failed to resolve import "./money-planner"`.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/money-planner.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/money-planner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/money-planner.ts web/lib/money-planner.test.ts
git commit -m "feat(money-planner): plan shape, validation and monthly net

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 3: Event expansion and roll-forward

**Files:**
- Modify: `web/lib/money-planner.ts`
- Test: `web/lib/money-planner.test.ts`

**Interfaces:**
- Consumes: `dueDatesBetween`, `payDatesBetween`, `nextOccurrenceOnOrAfter`, `compareIso` from `money-planner-dates.ts`; `Plan`, `Expense`, `Money`, `validatePlan` from Task 2.
- Produces:
  - `type RawEvent = { date: IsoDate; label: string; delta: Money; kind: "expense" | "salary" }`
  - `buildEvents(plan: Plan, from: IsoDate, until: IsoDate): RawEvent[]` — sorted by date; on a shared date, expenses before salary.
  - `rollForward(plan: Plan, today: IsoDate): Plan` — each expense's `nextDue` advanced to the first occurrence on or after `today`.

Expense deltas are negative, salary deltas positive. Sorting expenses first on a shared date is the pessimistic order: it never names a date that a same-day debit would have broken.

- [ ] **Step 1: Write the failing tests**

Append to `web/lib/money-planner.test.ts`, reusing the `plan()` and `expense()` helpers already in that file. Add `buildEvents` and `rollForward` to its import.

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/money-planner.test.ts`
Expected: FAIL — `buildEvents is not a function`, `rollForward is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `web/lib/money-planner.ts`, replacing the type-only import of `IsoDate` with a value import:

```ts
import {
  compareIso,
  dueDatesBetween,
  nextOccurrenceOnOrAfter,
  payDatesBetween,
  type IsoDate,
} from "./money-planner-dates";

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/money-planner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/money-planner.ts web/lib/money-planner.test.ts
git commit -m "feat(money-planner): expand a plan into dated events and roll stale dues forward

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 4: The affordability simulation

**Files:**
- Modify: `web/lib/money-planner.ts`
- Test: `web/lib/money-planner.test.ts`

**Interfaces:**
- Consumes: `buildEvents`, `validatePlan`, `monthlyNet`, `addYears`.
- Produces:
  - `type PlanEvent = { date: IsoDate; label: string; delta: Money; balanceAfter: Money }`
  - `type AffordResult` — the four-way union below.
  - `computeAffordDate(plan: Plan, today: IsoDate, horizonYears?: number): AffordResult` (`horizonYears` defaults to 10).

```ts
export type AffordResult =
  | { kind: "invalid"; problems: string[] }
  | { kind: "already" }
  | { kind: "date"; date: IsoDate; balanceThen: Money; timeline: PlanEvent[] }
  | { kind: "unreachable"; reason: "negative" | "horizon"; monthlyNet: number };
```

The checkpoint rule, stated once: walk the sorted events carrying a running balance. After the last event of each date, test whether `balance − price` still covers every expense between here and the next salary credit. Because expenses sort before salary on a shared date, "everything before the next salary event" naturally includes the expenses that land on the salary's own date. The same test runs once before any event has settled; passing there is `already`.

- [ ] **Step 1: Write the failing tests**

Append to `web/lib/money-planner.test.ts`, adding `computeAffordDate` to the import.

```ts
describe("computeAffordDate", () => {
  it("refuses to compute an invalid plan", () => {
    const result = computeAffordDate(plan({ payDay: 0 }), "2026-09-19");
    expect(result).toEqual({
      kind: "invalid",
      problems: ["Pay day must be a whole day between 1 and 31"],
    });
  });

  it("says already when the balance covers the price and the cycle ahead", () => {
    const result = computeAffordDate(
      plan({ balance: 200_000, expenses: [], target: { name: "Camera", price: 90_000 } }),
      "2026-09-19",
    );
    expect(result).toEqual({ kind: "already" });
  });

  it("is not already when the purchase would leave the next bill unpayable", () => {
    // 95,000 in hand, a 90,000 camera, and 20,000 of rent due before pay day.
    const result = computeAffordDate(
      plan({
        balance: 95_000,
        payDay: 1,
        expenses: [expense({ name: "Rent", amount: 20_000, nextDue: "2026-10-01" })],
        target: { name: "Camera", price: 90_000 },
      }),
      "2026-09-19",
    );
    expect(result.kind).toBe("date");
  });

  it("counts today's salary as upcoming, not as money in hand", () => {
    // Pay day is today. The balance typed in is what the account holds now, so
    // today's credit may not have landed — it must not be spent in advance.
    const result = computeAffordDate(
      plan({
        balance: 10_000,
        salary: 80_000,
        payDay: 19,
        expenses: [],
        target: { name: "Camera", price: 85_000 },
      }),
      "2026-09-19",
    );
    expect(result).toMatchObject({ kind: "date", date: "2026-09-19", balanceThen: 90_000 });
  });

  it("names the first pay day the money is there", () => {
    const result = computeAffordDate(
      plan({
        balance: 0,
        salary: 80_000,
        payDay: 1,
        expenses: [expense({ name: "Rent", amount: 50_000, nextDue: "2026-10-02" })],
        target: { name: "Camera", price: 60_000 },
      }),
      "2026-09-19",
    );
    // Oct 1 salary 80,000; Oct 2 rent 50,000 leaves 30,000. Nov 1 salary takes
    // it to 110,000, and 110,000 − 60,000 covers the 50,000 rent due Nov 2.
    expect(result).toMatchObject({ kind: "date", date: "2026-11-01", balanceThen: 110_000 });
  });

  it("pushes the date past a quarterly bill that lands just before it", () => {
    const withoutWifi = computeAffordDate(
      plan({
        balance: 0,
        salary: 30_000,
        payDay: 1,
        expenses: [],
        target: { name: "Phone", price: 60_000 },
      }),
      "2026-09-19",
    );
    const withWifi = computeAffordDate(
      plan({
        balance: 0,
        salary: 30_000,
        payDay: 1,
        expenses: [expense({ name: "Wifi", amount: 18_000, everyMonths: 3, nextDue: "2026-10-20" })],
        target: { name: "Phone", price: 60_000 },
      }),
      "2026-09-19",
    );
    expect(withoutWifi).toMatchObject({ kind: "date", date: "2026-11-01" });
    expect(withWifi).toMatchObject({ kind: "date", date: "2026-12-01" });
  });

  it("tests only at the end of a date, never between two events sharing one", () => {
    // Salary and rent both land on the 1st. Mid-date the balance briefly looks
    // short; the answer must be the date, not the event.
    const result = computeAffordDate(
      plan({
        balance: 0,
        salary: 80_000,
        payDay: 1,
        expenses: [expense({ name: "Rent", amount: 10_000, nextDue: "2026-10-01" })],
        target: { name: "Camera", price: 60_000 },
      }),
      "2026-09-19",
    );
    expect(result).toMatchObject({ kind: "date", date: "2026-10-01", balanceThen: 70_000 });
  });

  it("returns the events that led to the answer", () => {
    const result = computeAffordDate(
      plan({
        balance: 0,
        salary: 80_000,
        payDay: 1,
        expenses: [],
        target: { name: "Camera", price: 90_000 },
      }),
      "2026-09-19",
    );
    expect(result).toMatchObject({ kind: "date", date: "2026-11-01" });
    if (result.kind !== "date") throw new Error("expected a date");
    expect(result.timeline).toEqual([
      { date: "2026-10-01", label: "Salary", delta: 80_000, balanceAfter: 80_000 },
      { date: "2026-11-01", label: "Salary", delta: 80_000, balanceAfter: 160_000 },
    ]);
  });

  it("reports a shortfall rather than a date when nothing is left over", () => {
    const result = computeAffordDate(
      plan({
        balance: 0,
        salary: 30_000,
        payDay: 1,
        expenses: [expense({ name: "Rent", amount: 34_200, nextDue: "2026-10-02" })],
        target: { name: "Camera", price: 90_000 },
      }),
      "2026-09-19",
    );
    expect(result).toEqual({ kind: "unreachable", reason: "negative", monthlyNet: -4_200 });
  });

  it("calls a net of exactly zero unreachable", () => {
    const result = computeAffordDate(
      plan({
        balance: 0,
        salary: 30_000,
        payDay: 1,
        expenses: [expense({ name: "Rent", amount: 30_000, nextDue: "2026-10-02" })],
        target: { name: "Camera", price: 90_000 },
      }),
      "2026-09-19",
    );
    expect(result).toMatchObject({ kind: "unreachable", reason: "negative" });
  });

  it("distinguishes a positive net that misses the horizon", () => {
    const result = computeAffordDate(
      plan({
        balance: 0,
        salary: 1_000,
        payDay: 1,
        expenses: [],
        target: { name: "House", price: 10_000_000 },
      }),
      "2026-09-19",
    );
    expect(result).toMatchObject({ kind: "unreachable", reason: "horizon", monthlyNet: 1_000 });
  });

  it("respects a shorter horizon", () => {
    const reachable = plan({
      balance: 0,
      salary: 10_000,
      payDay: 1,
      expenses: [],
      target: { name: "Laptop", price: 300_000 },
    });
    expect(computeAffordDate(reachable, "2026-09-19", 10).kind).toBe("date");
    expect(computeAffordDate(reachable, "2026-09-19", 1)).toMatchObject({
      kind: "unreachable",
      reason: "horizon",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/money-planner.test.ts`
Expected: FAIL — `computeAffordDate is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `web/lib/money-planner.ts`, extending the `money-planner-dates` import with `addYears`:

```ts
export type PlanEvent = {
  date: IsoDate;
  label: string;
  delta: Money;
  balanceAfter: Money;
};

export type AffordResult =
  | { kind: "invalid"; problems: string[] }
  | { kind: "already" }
  | { kind: "date"; date: IsoDate; balanceThen: Money; timeline: PlanEvent[] }
  | { kind: "unreachable"; reason: "negative" | "horizon"; monthlyNet: number };

// Everything that has to be paid between this point in the stream and the next
// salary credit. Expenses sort before salary on a shared date, so stopping at
// the salary event counts the bills due on pay day itself — they settle first.
function dueBeforeNextSalary(events: RawEvent[], cursor: number): Money {
  let owed = 0;
  for (let i = cursor + 1; i < events.length; i += 1) {
    if (events[i].kind === "salary") {
      return owed;
    }
    owed -= events[i].delta;
  }
  return owed;
}

export function computeAffordDate(plan: Plan, today: IsoDate, horizonYears = 10): AffordResult {
  const problems = validatePlan(plan);
  if (problems.length > 0) {
    return { kind: "invalid", problems };
  }

  const events = buildEvents(plan, today, addYears(today, horizonYears));
  const price = plan.target.price;

  // Checkpoint zero: nothing has settled. Events dated today are still ahead.
  if (plan.balance - price >= dueBeforeNextSalary(events, -1)) {
    return { kind: "already" };
  }

  const timeline: PlanEvent[] = [];
  let balance = plan.balance;

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    balance += event.delta;
    timeline.push({
      date: event.date,
      label: event.label,
      delta: event.delta,
      balanceAfter: balance,
    });

    const lastOfDate = i + 1 === events.length || events[i + 1].date !== event.date;
    if (lastOfDate && balance - price >= dueBeforeNextSalary(events, i)) {
      return { kind: "date", date: event.date, balanceThen: balance, timeline };
    }
  }

  const net = monthlyNet(plan);
  return { kind: "unreachable", reason: net <= 0 ? "negative" : "horizon", monthlyNet: net };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/money-planner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/money-planner.ts web/lib/money-planner.test.ts
git commit -m "feat(money-planner): simulate the plan and name the affordable date

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 5: localStorage persistence

**Files:**
- Create: `web/lib/money-planner-storage.ts`
- Test: `web/lib/money-planner-storage.test.ts`

**Interfaces:**
- Consumes: `Plan` from `money-planner.ts`.
- Produces:
  - `const STORAGE_KEY = "money-planner"`
  - `const EMPTY_PLAN: Plan`
  - `loadPlan(): Plan | null` — `null` for missing, unparseable, or wrong-version data.
  - `savePlan(plan: Plan): void`

No date logic here. The page calls `rollForward(loaded, today)` after loading; keeping `today` out of this module keeps it a plain read/write.

- [ ] **Step 1: Write the failing tests**

```ts
// web/lib/money-planner-storage.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/money-planner-storage.test.ts`
Expected: FAIL — `Failed to resolve import "./money-planner-storage"`.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/money-planner-storage.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/money-planner-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/money-planner-storage.ts web/lib/money-planner-storage.test.ts
git commit -m "feat(money-planner): keep the plan in localStorage

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 6: Display formatting

**Files:**
- Create: `web/components/money-planner/format.ts`
- Test: `web/components/money-planner/format.test.ts`

**Interfaces:**
- Consumes: `parseIso`, `IsoDate` from `web/lib/money-planner-dates.ts`.
- Produces:
  - `formatInr(amount: number): string`
  - `formatLongDate(date: IsoDate): string` — `"4 March 2027"`
  - `formatAway(from: IsoDate, to: IsoDate): string` — `"17 months away"`, `"today"`, `"1 month away"`

`formatLongDate` maps month names from an array rather than going through `Date` or `Intl.DateTimeFormat`: the input is a date-only string, and every route through `Date` reintroduces the timezone shift Task 1 exists to avoid.

`formatInr` does use `Intl`, which is the right tool for lakh grouping — but its output varies between a full-ICU Node and a small-ICU one, which is exactly the Windows-local versus Linux-CI split. The test guards on the runtime's own grouping rather than asserting a fixed string.

- [ ] **Step 1: Write the failing tests**

```ts
// web/components/money-planner/format.test.ts
import { describe, expect, it } from "vitest";
import { formatAway, formatInr, formatLongDate } from "./format";

const groupsIndian = new Intl.NumberFormat("en-IN").format(125_000).includes("1,25,000");

describe("formatInr", () => {
  it("prefixes the rupee sign and drops the paise", () => {
    expect(formatInr(125_000)).toContain("₹");
    expect(formatInr(125_000)).not.toContain(".");
  });

  it.runIf(groupsIndian)("groups in lakhs", () => {
    // Skipped on a small-ICU Node, where en-IN falls back to western grouping.
    expect(formatInr(125_000)).toContain("1,25,000");
  });

  it("formats a negative amount", () => {
    expect(formatInr(-4_200)).toContain("4,200");
  });

  it("rounds a fractional average to whole rupees", () => {
    expect(formatInr(58_400.5)).not.toContain(".");
  });
});

describe("formatLongDate", () => {
  it("reads the date as written, with no timezone in the way", () => {
    expect(formatLongDate("2027-03-04")).toBe("4 March 2027");
    expect(formatLongDate("2026-12-31")).toBe("31 December 2026");
    expect(formatLongDate("2026-01-01")).toBe("1 January 2026");
  });
});

describe("formatAway", () => {
  it("counts whole months", () => {
    expect(formatAway("2026-09-19", "2028-02-19")).toBe("17 months away");
  });

  it("does not pluralise a single month", () => {
    expect(formatAway("2026-09-19", "2026-10-19")).toBe("1 month away");
  });

  it("counts days when it is under a month", () => {
    expect(formatAway("2026-09-19", "2026-10-01")).toBe("12 days away");
    expect(formatAway("2026-09-19", "2026-09-20")).toBe("1 day away");
  });

  it("says today for today", () => {
    expect(formatAway("2026-09-19", "2026-09-19")).toBe("today");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run components/money-planner/format.test.ts`
Expected: FAIL — `Failed to resolve import "./format"`.

- [ ] **Step 3: Write the implementation**

```ts
// web/components/money-planner/format.ts
import { parseIso, type IsoDate } from "../../lib/money-planner-dates";

const RUPEES = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  // Both bounds, not just the maximum: older engines throw a RangeError when
  // the maximum is below the currency's default minimum of 2.
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatInr(amount: number): string {
  return RUPEES.format(Math.round(amount));
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Not Intl.DateTimeFormat: it wants a Date, and a Date built from a date-only
// string is midnight UTC, which reads back as the previous day in IST.
export function formatLongDate(date: IsoDate): string {
  const { year, month, day } = parseIso(date);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function formatAway(from: IsoDate, to: IsoDate): string {
  if (from === to) {
    return "today";
  }
  const a = parseIso(from);
  const b = parseIso(to);
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  if (b.day < a.day) {
    months -= 1;
  }
  if (months >= 1) {
    return `${months} ${months === 1 ? "month" : "months"} away`;
  }
  // Two UTC instants subtracted — no local getters anywhere, so the difference
  // is exact whatever zone the runtime is in.
  const days = Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
  return `${days} ${days === 1 ? "day" : "days"} away`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run components/money-planner/format.test.ts`
Expected: PASS (the lakh-grouping case may report as skipped).

- [ ] **Step 5: Commit**

```bash
git add web/components/money-planner/format.ts web/components/money-planner/format.test.ts
git commit -m "feat(money-planner): rupee and date formatting for the readout

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 7: The expense table

**Files:**
- Create: `web/components/money-planner/ExpenseTable.tsx`
- Create: `web/components/money-planner/ExpenseTable.stories.tsx`
- Test: `web/components/money-planner/ExpenseTable.test.tsx`

**Interfaces:**
- Consumes: `Expense` from `web/lib/money-planner.ts`; `IsoDate` from `web/lib/money-planner-dates.ts`.
- Produces: `ExpenseTable({ expenses, today, onChange }: { expenses: Expense[]; today: IsoDate; onChange: (next: Expense[]) => void })`

A controlled component: it holds no state, and every edit calls `onChange` with the whole next array. The page owns the plan.

`today` is a prop rather than a `new Date()` inside the component, for the same reason the calculation takes it as a parameter: it is the default a new row's `nextDue` gets, the page already holds it, and reading the clock here would be a second source of truth that disagrees with the answer on screen across midnight.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/money-planner/ExpenseTable.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExpenseTable } from "./ExpenseTable";
import type { Expense } from "../../lib/money-planner";

const TODAY = "2026-09-19";

const RENT: Expense = {
  id: "e1",
  name: "Rent",
  amount: 20_000,
  everyMonths: 1,
  nextDue: "2026-10-01",
};

describe("ExpenseTable", () => {
  it("renders a row per expense", () => {
    render(<ExpenseTable expenses={[RENT]} today={TODAY} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue("Rent")).toBeInTheDocument();
    expect(screen.getByDisplayValue("20000")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-10-01")).toBeInTheDocument();
  });

  it("says so when there are no expenses yet", () => {
    render(<ExpenseTable expenses={[]} today={TODAY} onChange={vi.fn()} />);
    expect(screen.getByText("No expenses yet.")).toBeInTheDocument();
  });

  it("reports a renamed expense", () => {
    const onChange = vi.fn();
    render(<ExpenseTable expenses={[RENT]} today={TODAY} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Expense 1 name"), { target: { value: "Wifi" } });
    expect(onChange).toHaveBeenCalledWith([{ ...RENT, name: "Wifi" }]);
  });

  it("reports an edited amount as a number", () => {
    const onChange = vi.fn();
    render(<ExpenseTable expenses={[RENT]} today={TODAY} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Expense 1 amount"), { target: { value: "21000" } });
    expect(onChange).toHaveBeenCalledWith([{ ...RENT, amount: 21_000 }]);
  });

  it("takes any whole number of months, not just the common ones", () => {
    const onChange = vi.fn();
    render(<ExpenseTable expenses={[RENT]} today={TODAY} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Expense 1 repeats every"), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith([{ ...RENT, everyMonths: 2 }]);
  });

  it("reports a cleared number field as NaN rather than zero", () => {
    // Zero would be a valid-looking plan and would silently change the answer
    // while the field is mid-edit. NaN fails validation, which is what an empty
    // box means.
    const onChange = vi.fn();
    render(<ExpenseTable expenses={[RENT]} today={TODAY} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Expense 1 repeats every"), { target: { value: "" } });
    expect(onChange.mock.calls[0][0][0].everyMonths).toBeNaN();
  });

  it("adds a row that is due today by default", () => {
    const onChange = vi.fn();
    render(<ExpenseTable expenses={[]} today={TODAY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0][0][0];
    expect(added).toMatchObject({ name: "", amount: 0, everyMonths: 1, nextDue: TODAY });
    expect(added.id).not.toBe("");
  });

  it("removes the row it was asked to remove", () => {
    const onChange = vi.fn();
    const second = { ...RENT, id: "e2", name: "Wifi" };
    render(<ExpenseTable expenses={[RENT, second]} today={TODAY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Wifi" }));
    expect(onChange).toHaveBeenCalledWith([RENT]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run components/money-planner/ExpenseTable.test.tsx`
Expected: FAIL — `Failed to resolve import "./ExpenseTable"`.

- [ ] **Step 3: Write the implementation**

```tsx
// web/components/money-planner/ExpenseTable.tsx
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run components/money-planner/ExpenseTable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the story**

Every component under `web/components/` has one, and the `chromatic` job gates `release`. No decorator is needed — `web/.storybook/preview.tsx` already applies the site theme and the font classes.

```tsx
// web/components/money-planner/ExpenseTable.stories.tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ExpenseTable } from "./ExpenseTable";

const meta = {
  title: "MoneyPlanner/ExpenseTable",
  component: ExpenseTable,
  args: { today: "2026-09-19", onChange: () => {} },
} satisfies Meta<typeof ExpenseTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { expenses: [] },
};

export const MixedCadences: Story = {
  args: {
    expenses: [
      { id: "e1", name: "Rent", amount: 20000, everyMonths: 1, nextDue: "2026-10-01" },
      { id: "e2", name: "Wifi", amount: 1800, everyMonths: 3, nextDue: "2026-10-04" },
      { id: "e3", name: "Insurance", amount: 12000, everyMonths: 12, nextDue: "2027-01-15" },
    ],
  },
};
```

- [ ] **Step 6: Check the story builds**

Run: `cd web && npm run build-storybook`
Expected: builds with no error naming `ExpenseTable.stories.tsx`.

- [ ] **Step 7: Commit**

```bash
git add web/components/money-planner/ExpenseTable.tsx web/components/money-planner/ExpenseTable.stories.tsx web/components/money-planner/ExpenseTable.test.tsx
git commit -m "feat(money-planner): editable expense table

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 8: The result panel

**Files:**
- Create: `web/components/money-planner/ResultPanel.tsx`
- Create: `web/components/money-planner/ResultPanel.stories.tsx`
- Test: `web/components/money-planner/ResultPanel.test.tsx`

**Interfaces:**
- Consumes: `AffordResult` from `web/lib/money-planner.ts`; `IsoDate` from `web/lib/money-planner-dates.ts`; `formatInr`, `formatLongDate`, `formatAway` from `./format`.
- Produces: `ResultPanel({ result, targetName, today }: { result: AffordResult; targetName: string; today: IsoDate })`

One component, four states, no branching left to the page.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/money-planner/ResultPanel.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResultPanel } from "./ResultPanel";
import type { AffordResult } from "../../lib/money-planner";

const TODAY = "2026-09-19";

function panel(result: AffordResult) {
  render(<ResultPanel result={result} targetName="Camera" today={TODAY} />);
}

describe("ResultPanel", () => {
  it("shows the date and how far off it is", () => {
    panel({
      kind: "date",
      date: "2027-03-04",
      balanceThen: 125_000,
      timeline: [{ date: "2026-10-01", label: "Salary", delta: 80_000, balanceAfter: 80_000 }],
    });
    expect(screen.getByText("4 March 2027")).toBeInTheDocument();
    expect(screen.getByText(/5 months away/)).toBeInTheDocument();
    expect(screen.getByText(/Camera/)).toBeInTheDocument();
  });

  it("lists the events behind the answer", () => {
    // The answer date differs from every timeline date on purpose: the heading
    // renders a long date too, and a shared one would match twice.
    panel({
      kind: "date",
      date: "2026-11-01",
      balanceThen: 160_000,
      timeline: [
        { date: "2026-10-01", label: "Salary", delta: 80_000, balanceAfter: 80_000 },
        { date: "2026-10-04", label: "Wifi", delta: -1_800, balanceAfter: 78_200 },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /how this adds up/i }));
    expect(screen.getByText("1 October 2026")).toBeInTheDocument();
    expect(screen.getByText("Wifi")).toBeInTheDocument();
  });

  it("says the money is already there", () => {
    panel({ kind: "already" });
    expect(screen.getByText(/today/i)).toBeInTheDocument();
  });

  it("gives the monthly shortfall when the net is negative", () => {
    panel({ kind: "unreachable", reason: "negative", monthlyNet: -4_200 });
    expect(screen.getByText(/4,200 short each month/)).toBeInTheDocument();
  });

  it("says more than ten years rather than never when the net is positive", () => {
    panel({ kind: "unreachable", reason: "horizon", monthlyNet: 1_000 });
    expect(screen.getByText(/more than ten years/i)).toBeInTheDocument();
    expect(screen.queryByText(/short each month/)).not.toBeInTheDocument();
  });

  it("lists what is wrong with an invalid plan", () => {
    panel({ kind: "invalid", problems: ["Pay day must be a whole day between 1 and 31"] });
    expect(screen.getByText("Pay day must be a whole day between 1 and 31")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run components/money-planner/ResultPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./ResultPanel"`.

- [ ] **Step 3: Write the implementation**

```tsx
// web/components/money-planner/ResultPanel.tsx
"use client";

import { useState } from "react";
import type { AffordResult } from "../../lib/money-planner";
import type { IsoDate } from "../../lib/money-planner-dates";
import { formatAway, formatInr, formatLongDate } from "./format";

export function ResultPanel({
  result,
  targetName,
  today,
}: {
  result: AffordResult;
  targetName: string;
  today: IsoDate;
}) {
  const [showTimeline, setShowTimeline] = useState(false);
  const thing = targetName.trim() || "it";

  if (result.kind === "invalid") {
    return (
      <div className="border border-line p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Not ready</p>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm text-fg">
          {result.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (result.kind === "already") {
    return (
      <div className="border border-line p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">The answer</p>
        <p className="mt-3 font-display text-4xl leading-tight">You can buy {thing} today.</p>
      </div>
    );
  }

  if (result.kind === "unreachable") {
    return (
      <div className="border border-line p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">The answer</p>
        <p className="mt-3 font-display text-4xl leading-tight">
          {result.reason === "negative"
            ? `Not on this budget — you are ${formatInr(Math.abs(result.monthlyNet))} short each month.`
            : `More than ten years away at ${formatInr(result.monthlyNet)} spare a month.`}
        </p>
      </div>
    );
  }

  return (
    <div className="border border-line p-6">
      <p className="text-xs uppercase tracking-[0.14em] text-muted">You can buy {thing} on</p>
      <p className="mt-3 font-display text-5xl leading-[0.95]">{formatLongDate(result.date)}</p>
      <p className="mt-3 text-sm text-muted">
        {formatAway(today, result.date)} — {formatInr(result.balanceThen)} in hand that day.
      </p>

      <button
        type="button"
        className="mt-6 text-[0.6875rem] uppercase tracking-[0.16em] text-muted hover:text-accent"
        onClick={() => setShowTimeline((open) => !open)}
      >
        {showTimeline ? "Hide how this adds up" : "How this adds up"}
      </button>

      {showTimeline ? (
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {result.timeline.map((event, index) => (
            <li
              key={`${event.date}-${event.label}-${index}`}
              className="flex justify-between gap-4"
            >
              <span className="text-muted">{formatLongDate(event.date)}</span>
              <span>{event.label}</span>
              <span className={event.delta < 0 ? "text-muted" : "text-accent"}>
                {formatInr(event.delta)}
              </span>
              <span className="text-muted">{formatInr(event.balanceAfter)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run components/money-planner/ResultPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the story**

```tsx
// web/components/money-planner/ResultPanel.stories.tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ResultPanel } from "./ResultPanel";

const meta = {
  title: "MoneyPlanner/ResultPanel",
  component: ResultPanel,
  args: { targetName: "Camera", today: "2026-09-19" },
} satisfies Meta<typeof ResultPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ADate: Story = {
  args: {
    result: {
      kind: "date",
      date: "2027-03-04",
      balanceThen: 125000,
      timeline: [
        { date: "2026-10-01", label: "Salary", delta: 80000, balanceAfter: 80000 },
        { date: "2026-10-04", label: "Wifi", delta: -1800, balanceAfter: 78200 },
      ],
    },
  },
};

export const Already: Story = {
  args: { result: { kind: "already" } },
};

export const Short: Story = {
  args: { result: { kind: "unreachable", reason: "negative", monthlyNet: -4200 } },
};

export const PastTheHorizon: Story = {
  args: { result: { kind: "unreachable", reason: "horizon", monthlyNet: 1000 } },
};

export const NotReady: Story = {
  args: {
    result: { kind: "invalid", problems: ["Pay day must be a whole day between 1 and 31"] },
  },
};
```

- [ ] **Step 6: Check the story builds**

Run: `cd web && npm run build-storybook`
Expected: builds with no error naming `ResultPanel.stories.tsx`.

- [ ] **Step 7: Commit**

```bash
git add web/components/money-planner/ResultPanel.tsx web/components/money-planner/ResultPanel.stories.tsx web/components/money-planner/ResultPanel.test.tsx
git commit -m "feat(money-planner): result panel for all four outcomes

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 9: The page

**Files:**
- Create: `web/app/tools/money-planner/page.tsx`
- Test: `web/app/tools/money-planner/page.test.tsx`

**Interfaces:**
- Consumes: `EMPTY_PLAN`, `loadPlan`, `savePlan`; `computeAffordDate`, `monthlyNet`, `rollForward`, `Plan`; `todayIso`; `ExpenseTable`, `ResultPanel`, `formatInr`; `CommandBar` from `web/components/site/CommandBar`.
- Produces: the default-exported page component.

Three rules this task exists to get right:

1. **Storage is read in a post-mount effect, never during render.** A client component that reads `localStorage` while rendering produces different markup than the server did, and React reports a hydration mismatch. The first render is always `EMPTY_PLAN`.
2. **`today` is captured once per mount**, into state, and passed to every calculation and to `ExpenseTable`. Calling `todayIso()` inside render would give a different answer across a midnight boundary mid-session and make the render impure.
3. **An untouched form gets no result panel**, not even a validation complaint. Nobody has asked it anything yet.

- [ ] **Step 1: Write the failing test**

```tsx
// web/app/tools/money-planner/page.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import MoneyPlannerPage from "./page";
import { STORAGE_KEY } from "../../../lib/money-planner-storage";
import type { Plan } from "../../../lib/money-planner";

// CommandBar (rendered here because the tool sits outside the (site) group)
// calls useRouter, which has no app router mounted under jsdom.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const SAVED: Plan = {
  v: 1,
  balance: 50_000,
  salary: 80_000,
  payDay: 1,
  expenses: [{ id: "e1", name: "Rent", amount: 20_000, everyMonths: 1, nextDue: "2026-10-01" }],
  target: { name: "Camera", price: 90_000 },
};

describe("Money Planner page", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the heading", () => {
    render(<MoneyPlannerPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Money Planner" })).toBeInTheDocument();
  });

  it("shows no result at all until something has been entered", () => {
    render(<MoneyPlannerPage />);
    expect(screen.getByLabelText("Balance today")).toHaveValue(0);
    // Not "Price must be more than zero" either — an untouched form has no
    // answer and nothing to complain about.
    expect(screen.queryByText("Not ready")).not.toBeInTheDocument();
    expect(screen.queryByText(/(months?|days?) away/)).not.toBeInTheDocument();
  });

  it("loads a saved plan after mount", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED));
    render(<MoneyPlannerPage />);
    await waitFor(() => expect(screen.getByLabelText("Balance today")).toHaveValue(50_000));
    expect(screen.getByDisplayValue("Rent")).toBeInTheDocument();
  });

  it("does not read storage during render", () => {
    // The real check for the hydration rule. render() flushes effects before it
    // returns, so a client-side assertion cannot tell a render-time read from an
    // effect. Server rendering runs no effects, so the saved 50,000 can only
    // reach this string if the component read storage while rendering — which
    // is the markup mismatch React would report on hydration.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED));
    expect(renderToString(<MoneyPlannerPage />)).not.toContain("50000");
  });

  it("answers as the fields are filled in, with no submit button", async () => {
    render(<MoneyPlannerPage />);
    fireEvent.change(screen.getByLabelText("Balance today"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Monthly salary"), { target: { value: "80000" } });
    fireEvent.change(screen.getByLabelText("Pay day"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("What are you buying"), { target: { value: "Camera" } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "90000" } });

    // Not /away|today/: "Balance today" is a label on this page and would match.
    await waitFor(() => expect(screen.getByText(/(months?|days?) away/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /calculate/i })).not.toBeInTheDocument();
  });

  it("says what is wrong instead of an answer when a field is cleared", async () => {
    render(<MoneyPlannerPage />);
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "90000" } });
    fireEvent.change(screen.getByLabelText("Pay day"), { target: { value: "" } });
    await waitFor(() =>
      expect(screen.getByText("Pay day must be a whole day between 1 and 31")).toBeInTheDocument(),
    );
  });

  it("saves what was typed", async () => {
    render(<MoneyPlannerPage />);
    fireEvent.change(screen.getByLabelText("Monthly salary"), { target: { value: "80000" } });
    await waitFor(() => {
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored as string).salary).toBe(80_000);
    });
  });

  it("keeps a way back to the public site", () => {
    render(<MoneyPlannerPage />);
    expect(screen.getByRole("link", { name: "Ashutosh Pandey" })).toHaveAttribute("href", "/");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run app/tools/money-planner/page.test.tsx`
Expected: FAIL — `Failed to resolve import "./page"`.

- [ ] **Step 3: Write the implementation**

```tsx
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
      // that have gone by.
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
                <p className="text-sm text-muted">{formatInr(net)} spare a month, on average.</p>
              </>
            )}
          </div>
        </div>
      </main>

      <CommandBar />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run app/tools/money-planner/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/tools/money-planner/page.tsx web/app/tools/money-planner/page.test.tsx
git commit -m "feat(money-planner): the tool page

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 10: Registration, e2e, changelog

**Files:**
- Modify: `web/lib/route-gate.ts` — the `TOOLS` array.
- Modify: `web/lib/route-gate.test.ts:92` — the exact href list.
- Modify: `web/lib/site/commands.ts` — the `COMMANDS` array.
- Modify: `web/lib/site/commands.test.ts` — **two** places: the exact id list and the `it.each` push table.
- Modify: `web/e2e/tools.spec.ts` — the hub link table.
- Create: `web/e2e/money-planner.spec.ts`
- Modify: `CHANGELOG.md`

Five hard-coded lists go red if any one is missed. This is one commit because none of them makes sense without the others.

**Interfaces:**
- Consumes: the page from Task 9.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test edits**

In `web/lib/route-gate.test.ts`, add the new href to the exact list:

```ts
    expect(TOOLS.map((tool) => tool.href)).toEqual([
      "/tools/bgm-looper",
      "/tools/resume-admin",
      "/tools/newsletter-admin",
      "/tools/money-planner",
      "/keystatic",
    ]);
```

In `web/lib/site/commands.test.ts`, add the id to the exact list:

```ts
      "open-newsletter-admin",
      "open-money-planner",
      "open-content-editor",
```

and add a row to the `it.each` table in the same file:

```ts
    ["open-newsletter-admin", "/tools/newsletter-admin"],
    ["open-money-planner", "/tools/money-planner"],
    ["open-content-editor", "/keystatic"],
```

In `web/e2e/tools.spec.ts`, add a row to the hub link table:

```ts
    ["Newsletter admin", "/tools/newsletter-admin"],
    ["Money Planner", "/tools/money-planner"],
    ["Content editor", "/keystatic"],
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/route-gate.test.ts lib/site/commands.test.ts`
Expected: FAIL — both exact-list assertions report the new entry missing from the received array.

- [ ] **Step 3: Register the tool**

In `web/lib/route-gate.ts`, add to `TOOLS` after the newsletter admin and before the content editor. `TOOLS` order is the hub's order, and the Keystatic entry is the odd one that does not live under `/tools`:

```ts
  {
    href: "/tools/money-planner",
    name: "Money Planner",
    kind: "Money",
    blurb:
      "Work out the date a purchase becomes affordable, from a balance, a salary and expenses on their own cadences.",
  },
```

In `web/lib/site/commands.ts`, add after `open-newsletter-admin`:

```ts
  {
    id: "open-money-planner",
    label: "open money-planner",
    hint: "Work out when you can afford something",
    run: (ctx) => ctx.push("/tools/money-planner"),
  },
```

- [ ] **Step 4: Run the unit suite to verify it passes**

Run: `cd web && npm test`
Expected: PASS, every file. `app/tools/page.test.tsx` derives its assertions from `TOOLS` and should go green with no edit — if it fails, the hub is not rendering the new row.

- [ ] **Step 5: Write the e2e spec**

```ts
// web/e2e/money-planner.spec.ts
import { test, expect } from "@playwright/test";

test("the money planner is reachable from the hub and answers", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/tools$/);

  await page.getByRole("link", { name: /Money Planner/ }).click();
  await expect(page).toHaveURL(/\/tools\/money-planner/);
  await expect(page.getByRole("heading", { level: 1, name: "Money Planner" })).toBeVisible();

  await page.getByLabel("Balance today").fill("0");
  await page.getByLabel("Monthly salary").fill("80000");
  await page.getByLabel("Pay day").fill("1");
  await page.getByLabel("What are you buying").fill("Camera");
  await page.getByLabel("Price").fill("90000");

  // Two months of salary with nothing going out. Assert on the shape of the
  // answer, not a fixed date — this suite runs on whatever day CI runs it. The
  // pattern excludes the bare word "today", which is also the "Balance today"
  // label and would be a strict-mode violation.
  await expect(page.getByText(/(months?|days?) away/)).toBeVisible();
});

test("the planner remembers a plan across a reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.goto("/tools/money-planner");

  await page.getByLabel("Monthly salary").fill("80000");

  // The input is controlled, so it holds the value immediately — but the save
  // is debounced by 300 ms. Reloading on the input's value alone races the
  // timer and the reload wins. Wait for the write itself.
  await page.waitForFunction(() =>
    (localStorage.getItem("money-planner") ?? "").includes('"salary":80000'),
  );

  await page.reload();
  await expect(page.getByLabel("Monthly salary")).toHaveValue("80000");
});
```

- [ ] **Step 6: Run the e2e suite**

Run: `cd web && npm run test:e2e`
Expected: PASS. Needs `npx playwright install chromium` once. Playwright builds and serves the app itself on port 3100 — do not start a dev server by hand.

- [ ] **Step 7: Add the changelog entry**

Under `## [Unreleased]`, in the `### Added` list (create the heading if it is not there):

```markdown
- Money Planner tool at `/tools/money-planner`: from a balance, a monthly salary and itemized expenses on their own cadences, the date a purchase becomes affordable without leaving the next pay cycle short.
```

- [ ] **Step 8: Lint and build**

Run: `cd web && npm run lint`
Expected: no errors.

Run: `cd web && KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build`
Expected: compiles. Without those three variables the build fails while collecting page data for `/api/keystatic/[...params]` — that is a missing env var, not a build bug.

- [ ] **Step 9: Commit**

```bash
git add web/lib/route-gate.ts web/lib/route-gate.test.ts web/lib/site/commands.ts web/lib/site/commands.test.ts web/e2e/tools.spec.ts web/e2e/money-planner.spec.ts CHANGELOG.md
git commit -m "feat(money-planner): register the tool on the hub and the command bar

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

- [ ] **Step 10: Open the implementation PR**

```bash
git push -u origin feat/money-planner
gh pr create --base dev --title "feat: Money Planner tool" --body "Closes #N.

A gated tool at /tools/money-planner. Enter a balance, a monthly salary and a pay day, itemize expenses with their own cadences, name what you want to buy — it returns the date the purchase becomes affordable without leaving the next pay cycle short.

No API route and no server state: the plan lives in localStorage and the whole calculation is a pure function.

- lib/money-planner-dates.ts — calendar arithmetic on date-only ISO strings, integers only, so nothing shifts between IST locally and UTC in CI.
- lib/money-planner.ts — validation, event expansion, and the simulation.
- lib/money-planner-storage.ts — the localStorage blob, versioned.
- components/money-planner/ — the expense table and the result panel, with stories.

Spec: docs/superpowers/specs/2026-09-19-money-planner-design.md
Plan: docs/superpowers/plans/2026-09-19-money-planner.md"
```

Then follow the root `CLAUDE.md` merge sequence: four CI jobs green, `Release readiness review: change approved`, both bots' inline comments read via `gh api --paginate .../pulls/<N>/comments` and triaged by severity, threads replied to and resolved, `MERGEABLE / CLEAN`, then `gh pr merge <N> --squash --delete-branch`, then `git checkout dev && git pull --ff-only origin dev`.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: data model → Task 2; roll-forward and the stale-`nextDue` rule → Tasks 1 and 3; the validity guard → Task 2; the simulation, checkpoints and the four result kinds → Task 4; storage and versioning → Task 5; INR and date formatting → Task 6; the form, the expense table and the result panel → Tasks 7–9; hydration → Task 9; registration and the five hard-coded lists → Task 10; delivery, label and issue → Task 0 and Task 10 step 10.

**Names used consistently across tasks.** `validatePlan`, `monthlyNet`, `buildEvents`, `rollForward`, `computeAffordDate`, `loadPlan`, `savePlan`, `EMPTY_PLAN`, `STORAGE_KEY`, `formatInr`, `formatLongDate`, `formatAway`, `ExpenseTable`, `ResultPanel`, `todayIso`, `dueDatesBetween`, `payDatesBetween`, `nextOccurrenceOnOrAfter`, `makeIso`, `parseIso`, `compareIso`, `lastDayOfMonth`, `addYears`. Types: `Money`, `Expense`, `Plan`, `RawEvent`, `PlanEvent`, `AffordResult`, `IsoDate`.

**Fixtures verified, not hand-waved.** Every expected value in Task 1's and Task 4's tests — the clamped pay-day sequences, the 31 January quarterly anchoring, the 1 November and 1 December answers, the `negative`/`horizon` split — was produced by running a reference implementation of the rules in Global Constraints, not derived by hand. If the real implementation disagrees with one, the implementation is wrong, or it has departed from the checkpoint rule. The rule is the specification; re-derive from it before editing a fixture.
