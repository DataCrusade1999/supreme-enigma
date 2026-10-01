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

// The breakdown table's date column: the three-letter month keeps all four
// columns inside a phone-width panel.
export function formatShortDate(date: IsoDate): string {
  const { year, month, day } = parseIso(date);
  return `${day} ${MONTHS[month - 1].slice(0, 3)} ${year}`;
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
