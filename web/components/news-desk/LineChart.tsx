import type { Point } from "../../lib/news-desk/series";

// Hand-written rather than a chart library: one line chart in one place (spec D8).
const W = 320;
const H = 160;
const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

export function LineChart({ title, unit, points }: { title: string; unit: string; points: Point[] }) {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = W - PAD.left - PAD.right;
  const height = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? width / 2 : (i * width) / (points.length - 1));
  const y = (v: number) => PAD.top + ((max - v) * height) / span;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <figure className="mt-3">
      <figcaption className="text-xs text-muted">{title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 w-full"
        role="img"
        aria-label={`${title}: ${points.length} points, latest ${last.value}${unit} in ${last.period}`}
      >
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} className="stroke-rule" />
        <text x={PAD.left - 4} y={y(max) + 4} textAnchor="end" className="fill-muted text-[10px]">
          {max}
          {unit}
        </text>
        {max !== min && (
          <text x={PAD.left - 4} y={y(min) + 4} textAnchor="end" className="fill-muted text-[10px]">
            {min}
            {unit}
          </text>
        )}
        <polyline
          fill="none"
          strokeWidth={1.5}
          className="stroke-accent"
          points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
        />
        <text x={x(0)} y={H - 6} className="fill-muted text-[10px]">
          {first.period}
        </text>
        {points.length > 1 && (
          <text x={x(points.length - 1)} y={H - 6} textAnchor="end" className="fill-muted text-[10px]">
            {last.period}
          </text>
        )}
      </svg>
    </figure>
  );
}
