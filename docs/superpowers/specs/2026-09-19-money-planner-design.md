# Money Planner — design

Date: 2026-09-19
Status: approved, not implemented

## Problem

Given what I have today, what I earn, and everything I spend — including expenses
that recur every three months or once a year rather than monthly — tell me the
exact date I can buy a specific thing without leaving myself short before the
next salary.

A month-count answer ("about 17 months") is not good enough. A ₹18,000 insurance
premium landing the week before the target date changes the answer, and only a
dated simulation catches that.

## Scope

A fourth gated tool at `/tools/money-planner`. One client page, one pure
calculation module, no API route, no persistence outside the browser.

Out of scope: inflation, interest on savings, EMIs and loans, multiple
simultaneous goals, income that changes over time, any server-side storage.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Persistence | `localStorage`, one versioned JSON blob | Single user. No API route means no `GATED_PREFIXES` entry, no IAM, no Terraform, and salary figures never leave the browser. |
| Expense model | Fully itemized, each with its own cadence | Lets the result name which expense delayed the date. |
| Start state | Current balance + fixed monthly salary on a pay day | The answer is a real date, not a duration from zero. |
| Affordability | `balance − price` must still cover every expense due before the next salary | Never recommends a date that leaves rent unpayable the following week. |
| Currency | INR, `en-IN` grouping | Matches how every other figure in this project is tracked. |
| Calculation | Dated event simulation | The only model that is correct when a large irregular expense lands near the target. |

## Data model

Stored in `localStorage` under a single key, versioned so a later shape change
migrates instead of crashing on old data.

```ts
type Money = number;            // whole rupees, integer — never a float

type Expense = {
  id: string;
  name: string;                 // "Wifi", "Rent"
  amount: Money;
  everyMonths: number;          // 1 monthly, 3 quarterly, 12 annual
  nextDue: string;              // ISO date
};

type Plan = {
  v: 1;
  balance: Money;               // what is in hand today
  salary: Money;                // net, per month
  payDay: number;               // 1–31, clamped to the last day of short months
  expenses: Expense[];
  target: { name: string; price: Money };
};
```

`nextDue` anchors each expense rather than a start date. A start date in the past
forces the code to work out how many cycles have elapsed and invites off-by-one
errors across month lengths; the next due date is also the thing actually known
("the wifi recharge is due on the 4th").

Amounts are integer rupees. Floating-point paise would make the
`balance ≥ price` comparison unreliable at the boundary.

A stored plan reopened weeks later has `nextDue` dates in the past. Those are
rolled forward, never replayed — see the calculation below — and the page rewrites
the stored value on load so the form does not show a date that has gone by.

A plan is invalid if any `everyMonths` is below 1, `payDay` is outside 1–31, or
any amount is not a finite non-negative integer. `everyMonths` of 0 is reachable
in normal use: the field is briefly empty mid-typing, and a cadence of zero would
expand forever and hang the tab. The lib rejects an invalid plan up front and the
page does not render a result for one.

## Calculation

`web/lib/money-planner.ts`. No React, no imports from the app. `today` is a
parameter rather than a call to `Date.now()`, so tests pin time without faking
timers — the same convention `web/lib/auth.ts` uses for `now`.

```ts
export function computeAffordDate(
  plan: Plan,
  today: string,
  horizonYears = 10,
): AffordResult;
```

Steps:

1. Reject an invalid plan (see above) before doing anything else.
2. Expand the salary and every expense into dated events from `today` to the
   horizon. A pay day of 29–31 clamps to the last day of months that are shorter.
   An expense recurring `everyMonths` clamps the same way, anchored to the
   day-of-month of its `nextDue`.
3. An expense whose `nextDue` is already in the past contributes no events before
   `today`. Its first event is the earliest `nextDue + k × everyMonths` that is on
   or after `today`. Past occurrences are skipped, not debited — that money is
   already gone, and it is reflected in the balance the user typed in.
4. Sort by date. On a shared date, expenses settle before salary. This is the
   pessimistic order: the tool never names a date that a same-day debit would
   have broken.
5. Walk the events, carrying a running balance.
6. At each event date, test whether the purchase is safe:
   `balance − price ≥ sum(expenses due strictly after this date, up to and
   including the next salary date)`.
7. The first date that passes is the answer.

The affordability test looks forward exactly one pay cycle and no further. Two
consequences, both intended: the answer is usually a pay day or the day after a
large expense clears, and an expense-heavy cycle pushes the date past it rather
than into it.

### Result

```ts
type PlanEvent = {
  date: string;
  label: string;                // "Salary", "Wifi"
  delta: Money;                 // positive credit, negative debit
  balanceAfter: Money;
};

type AffordResult =
  | { kind: "invalid"; problems: string[] }
  | { kind: "already" }
  | { kind: "date"; date: string; balanceThen: Money; timeline: PlanEvent[] }
  | { kind: "unreachable"; reason: "negative" | "horizon"; monthlyNet: Money };
```

`already` means the affordability test passes against the balance as typed, with
every event dated today still ahead — not merely that `balance ≥ price`. A balance
that covers the price but leaves rent unpayable tomorrow is not "already". Events
dated today count as upcoming rather than settled: the balance the user typed is
what is in the account at the moment they are looking at the screen, so today's
salary has either already landed and been included in it, or has not landed yet
and must not be spent in advance.

The test runs once per distinct date, after every event on that date has
settled — never between two events sharing a date. Testing after a debit but
before that day's salary credit would name a date on which the money has not
arrived.

`unreachable` carries a reason because the two cases read differently. `negative`
is a monthly net of zero or less: the page says how much is short each month.
`horizon` is a positive net that still has not reached the price inside ten
years: the page says more than ten years, and gives no date.

`monthlyNet` is defined once, `salary − Σ(amount ÷ everyMonths)`, and both the
result and the page's own readout use that definition.

`timeline` is the events up to the answer, so the page can show why that date and
not an earlier one.

All arithmetic is on calendar dates. `today` and `nextDue` are date-only ISO
strings and stay that way — no time-of-day, no mixing UTC and local getters.
Vitest runs in IST on Windows locally and in UTC on Linux in CI, and a date built
from a bare ISO string then read through local getters differs between the two.

### Cases the tests pin

- Pay day 31 in a 30-day month, and in February.
- Pay day 29 in a non-leap February.
- An expense due today.
- Salary and an expense on the same date.
- `everyMonths: 3` crossing a year boundary.
- No expenses at all.
- A price the balance already covers safely, today.
- A price the balance covers but which fails the next-cycle test today, so the
  answer is a later date rather than `already`.
- A `nextDue` months in the past: rolled forward, and not debited for the
  occurrences that have gone by.
- Net flow of exactly zero, and a positive net that does not arrive inside the
  horizon — distinguished by `reason`.
- `everyMonths` of 0, a `payDay` of 0 or 32, and a negative amount: all rejected
  as invalid rather than looping or returning a wrong date.
- A balance that would reach the price but fails the next-cycle test, so the
  answer moves to the following event.

## Page

`web/app/tools/money-planner/page.tsx`, a client component.

Shell matches the other tool pages: the slim header used by
`/tools/newsletter-admin` and `/tools/resume-admin` (tool pages sit outside the
`(site)` route group, so there is no `SiteHeader`), plus `CommandBar`. Tailwind
v4 tokens, dark by default.

Two columns on wide screens, stacked on narrow:

- **Form** — balance, salary, pay day, target name and price, then an editable
  expense table with add and remove. Each expense row is name, amount, cadence,
  next due.
- **Result** — the date as the largest thing on the page, with how far away it
  is; the balance on that date; the monthly net; and a collapsible timeline of
  the events that led there.

Recomputes on every keystroke. There is no submit button and nothing to wait for.
Writes to `localStorage` debounced. With an empty form the result panel is
absent rather than showing a wrong answer built from zeros, and an invalid plan
shows what is wrong rather than a result.

The first render is the empty form. Stored data is read in a post-mount effect,
never during render — reading `localStorage` while rendering would not match what
the server produced and React would report a hydration mismatch.

Monthly net — salary minus the average monthly expense load — is shown alongside
the date because it explains every answer the tool gives.

## Registration

- One `TOOLS` entry in `web/lib/route-gate.ts`: href `/tools/money-planner`,
  `kind: "Money"`. The href sits under `/tools`, which is gated as a whole
  namespace, so `GATED_PREFIXES` needs no change.
- One `open money-planner` row in `web/lib/site/commands.ts`. Command labels are
  written by hand, not derived.

Three places hard-code the tool list and go red without the new entry:

- `web/lib/route-gate.test.ts` — asserts the exact href array.
- `web/app/tools/page.test.tsx` — derives from `TOOLS`, should pass untouched.
- `web/e2e/tools.spec.ts` — hub link table.

## Testing

- `web/lib/money-planner.test.ts` carries the weight, written first, covering
  every case listed above.
- `web/app/tools/money-planner/page.test.tsx` mirrors the resume admin's: it
  renders, accepts input, and shows a result.
- One Playwright spec: log in, open the tool, fill it, see a date.

## Delivery

A GitHub issue under a new `area: finance` label, then a branch off `dev`, a
`CHANGELOG.md` entry under `[Unreleased]` in the same PR, and a PR into `dev`
carrying `Closes #N`.

No `lambda/` or `infra/` changes, so CI skips `deploy` and there is no
`terraform plan` to run.
