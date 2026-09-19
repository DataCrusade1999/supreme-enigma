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
// earlier for the rest of the year. `day` overrides the day-of-month used —
// callers pass the original, never-clamped anchor day so a persisted anchor
// that was itself clamped (e.g. 31 January rolled into 28 February) does not
// become the new anchor day for every occurrence after it.
function shifted(anchor: IsoDate, months: number, day?: number): IsoDate {
  const { year, month, day: anchorDay } = parseIso(anchor);
  const index = month - 1 + months;
  return makeIso(year + Math.floor(index / 12), (((index % 12) + 12) % 12) + 1, day ?? anchorDay);
}

export function nextOccurrenceOnOrAfter(
  anchor: IsoDate,
  everyMonths: number,
  from: IsoDate,
  anchorDay?: number,
): IsoDate {
  const a = parseIso(anchor);
  const f = parseIso(from);
  const gap = (f.year - a.year) * 12 + (f.month - a.month);
  let k = Math.max(0, Math.floor(gap / everyMonths));
  // The month estimate can be one cycle short when the day-of-month has not
  // arrived yet; step, never guess twice.
  while (compareIso(shifted(anchor, k * everyMonths, anchorDay), from) < 0) {
    k += 1;
  }
  return shifted(anchor, k * everyMonths, anchorDay);
}

export function dueDatesBetween(
  anchor: IsoDate,
  everyMonths: number,
  from: IsoDate,
  until: IsoDate,
  anchorDay?: number,
): IsoDate[] {
  const first = nextOccurrenceOnOrAfter(anchor, everyMonths, from, anchorDay);
  const a = parseIso(anchor);
  const f = parseIso(first);
  let k = Math.round(((f.year - a.year) * 12 + (f.month - a.month)) / everyMonths);
  const out: IsoDate[] = [];
  for (let date = first; compareIso(date, until) <= 0; ) {
    out.push(date);
    k += 1;
    date = shifted(anchor, k * everyMonths, anchorDay);
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
