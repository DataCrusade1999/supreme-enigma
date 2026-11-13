const UNTIL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

// Joined by hand: the formatter's own literals differ across ICU builds.
export function formatUntil(epochSeconds: number): string {
  const p = Object.fromEntries(UNTIL.formatToParts(new Date(epochSeconds * 1000)).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()} IST`;
}

export function formatUses(n: number): string {
  return `${n} ${n === 1 ? "use" : "uses"}`;
}

export function formatDay(epochSeconds: number): string {
  const p = Object.fromEntries(DAY.formatToParts(new Date(epochSeconds * 1000)).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month}`;
}
