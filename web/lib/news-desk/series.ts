// Turns MoSPI get_data rows into [{period, value}] sorted oldest first. The same
// function serves the indicator table and, in Phase 4, chat charts, so a pinned
// row always matches its chart. See spec §6.4.

export type Point = { period: string; value: number };
export type SeriesResult = { ok: true; points: Point[] } | { ok: false; reason: string };

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CALENDAR_YEAR = /^\d{4}$/;
const FISCAL_YEAR = /^(\d{4})-\d{2}$/;
const FISCAL_QUARTER = /^Q([1-4])$/i;

/** A sort key in months since year 0, and a label. Null when the row has no
 * place in time we recognise. */
function place(row: Record<string, unknown>): { key: number; label: string } | null {
  const year = String(row.year ?? "").trim();
  const month = typeof row.month === "string" ? MONTHS.indexOf(row.month.trim().toLowerCase()) : -1;
  const quarter = typeof row.quarter === "string" ? FISCAL_QUARTER.exec(row.quarter.trim()) : null;
  const fiscal = FISCAL_YEAR.exec(year);

  if (CALENDAR_YEAR.test(year) && month >= 0) {
    return { key: Number(year) * 12 + month, label: `${SHORT[month]} ${year}` };
  }
  if (fiscal && month >= 0) {
    // India's fiscal year runs April to March.
    const calendarYear = Number(fiscal[1]) + (month < 3 ? 1 : 0);
    return { key: calendarYear * 12 + month, label: `${SHORT[month]} ${calendarYear}` };
  }
  if (fiscal && quarter) {
    const q = Number(quarter[1]);
    return { key: Number(fiscal[1]) * 12 + 3 + (q - 1) * 3, label: `Q${q} ${year}` };
  }
  if (fiscal && row.month == null && row.quarter == null) {
    return { key: Number(fiscal[1]) * 12 + 3, label: year };
  }
  return null;
}

export function toSeries(rows: Record<string, unknown>[], valueField: string): SeriesResult {
  const points: (Point & { key: number })[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const at = place(row);
    if (!at) return { ok: false, reason: `cannot place a row in time (year ${String(row.year)})` };
    const raw = row[valueField];
    // Base-2024 CPI has 2025 rows with an index but a null inflation figure.
    if (raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) return { ok: false, reason: `${valueField} is not a number: ${String(raw)}` };
    // Two rows for one period means the filters did not narrow MoSPI to one
    // series; picking either would show a number from the wrong series.
    if (seen.has(at.key)) {
      return { ok: false, reason: `two rows for ${at.label}; the filters match more than one series` };
    }
    seen.add(at.key);
    points.push({ key: at.key, period: at.label, value });
  }
  points.sort((a, b) => a.key - b.key);
  return { ok: true, points: points.map(({ period, value }) => ({ period, value })) };
}
