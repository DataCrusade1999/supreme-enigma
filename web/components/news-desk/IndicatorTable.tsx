import { formatAge } from "../../lib/news-desk/format";
import type { IndicatorValue } from "../../lib/news-desk/types";

function show(value: number | null, unit: string): string {
  // As MoSPI publishes it: CPI to two decimals, the rest to one.
  return value === null ? "—" : `${value}${unit}`;
}

export function IndicatorTable({ indicators, now }: { indicators: IndicatorValue[]; now: Date }) {
  if (indicators.length === 0) {
    return <p className="text-sm text-muted">Indicators load on the next Refresh.</p>;
  }
  return (
    <table className="w-full text-sm">
      <caption className="mb-2 text-left text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
        Official indicators
      </caption>
      <thead>
        <tr className="border-b border-rule text-left text-xs text-muted">
          <th scope="col" className="py-2 font-normal">Indicator</th>
          <th scope="col" className="py-2 font-normal">Period</th>
          <th scope="col" className="py-2 text-right font-normal">Latest</th>
          <th scope="col" className="py-2 text-right font-normal">Prev</th>
        </tr>
      </thead>
      <tbody>
        {indicators.map((row) => (
          <tr key={row.id} className="border-b border-rule align-top">
            <td className="py-2 pr-2 text-fg">
              {row.label}
              {row.error && (
                <span
                  className="ml-1.5 text-[0.6875rem] uppercase tracking-[0.12em] text-accent"
                  title={
                    row.lastGoodAt
                      ? `Stale since ${formatAge(row.lastGoodAt, now)}. The last refresh failed: ${row.error}`
                      : `Not loaded yet: ${row.error}`
                  }
                >
                  {row.lastGoodAt ? "stale" : "not loaded"}
                </span>
              )}
            </td>
            <td className="py-2 pr-2 text-muted">{row.period ?? "—"}</td>
            <td className="py-2 text-right text-fg">{show(row.latest, row.unit)}</td>
            <td className="py-2 text-right text-muted" title={row.prevPeriod ?? undefined}>
              {show(row.prev, row.unit)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
