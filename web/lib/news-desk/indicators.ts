import { z } from "zod";
import { callTool } from "./mospi";
import { toSeries, type Point } from "./series";
import type { IndicatorDef, IndicatorValue } from "./types";

// MoSPI rejects a larger limit.
const PAGE_SIZE = "100";
// A matched definition pages until it holds two points. The previous month's
// CPI food row was on page 3 on 2026-09-26; four pages leave one spare, and at
// 10 s per call stay inside the refresh route's 60 s.
const MAX_PAGES = 4;

const dataSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  meta_data: z.object({ totalPages: z.coerce.number() }).partial().optional(),
});

function matches(row: Record<string, unknown>, match: Record<string, string> | undefined): boolean {
  if (!match) return true;
  return Object.entries(match).every(([field, value]) => String(row[field]) === value);
}

/** The definition's series, oldest first. Throws when MoSPI fails or has no values. */
export async function fetchSeries(def: IndicatorDef): Promise<Point[]> {
  const rows: Record<string, unknown>[] = [];
  let points: Point[] = [];
  for (let page = 1; page <= (def.match ? MAX_PAGES : 1); page++) {
    const response = dataSchema.parse(
      await callTool("get_data", {
        dataset: def.dataset,
        filters: { ...def.filters, limit: PAGE_SIZE, page: String(page) },
      }),
    );
    rows.push(...response.data.filter((row) => matches(row, def.match)));
    const series = toSeries(rows, def.valueField);
    if (!series.ok) throw new Error(series.reason);
    points = series.points;
    // Without a page count, keep going to MAX_PAGES rather than stop at page 1.
    const lastPage = response.meta_data?.totalPages ?? MAX_PAGES;
    if (points.length >= 2 || page >= lastPage) break;
  }
  if (points.length === 0) throw new Error("MoSPI returned no values for these filters");
  return points;
}

/** One value per definition, in order. Never throws: a failed query keeps the
 * previous values with `error` set and `lastGoodAt` unchanged (spec §6.4). */
export async function refreshIndicators(
  defs: IndicatorDef[],
  previous: IndicatorValue[],
  now: Date,
): Promise<IndicatorValue[]> {
  return Promise.all(
    defs.map(async (def): Promise<IndicatorValue> => {
      const base = { id: def.id, label: def.label, unit: def.unit };
      try {
        const points = await fetchSeries(def);
        const latest = points[points.length - 1];
        const prior = points.length > 1 ? points[points.length - 2] : undefined;
        return {
          ...base,
          period: latest.period,
          latest: latest.value,
          prevPeriod: prior?.period ?? null,
          prev: prior?.value ?? null,
          lastGoodAt: now.toISOString(),
        };
      } catch (err) {
        console.error(`news-desk: indicator ${def.id} failed`, err);
        const before = previous.find((p) => p.id === def.id);
        return {
          ...base,
          period: before?.period ?? null,
          latest: before?.latest ?? null,
          prevPeriod: before?.prevPeriod ?? null,
          prev: before?.prev ?? null,
          lastGoodAt: before?.lastGoodAt ?? null,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        };
      }
    }),
  );
}
