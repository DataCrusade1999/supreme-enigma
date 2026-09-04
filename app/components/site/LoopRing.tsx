import { WAVE, barClass } from "../../content/wave-envelope";

// The home page's own envelope wrapped into a circle: bar `i` sits at
// -90deg + i * (360/n), so index 0 is at twelve o'clock and the sequence closes
// onto its own start. Because the same eight values open and close the array,
// the bars either side of twelve o'clock are identical by construction — the
// ring shows the claim the home page's caption makes. Design spec §5.
//
// ~60 absolutely-positioned spans: no image asset, no canvas, no dependency.
export function LoopRing({
  radius = 104,
  scale = 0.5,
}: {
  radius?: number;
  scale?: number;
}) {
  const step = 360 / WAVE.length;
  // The box has to clear the longest bar, which grows outward from the circle.
  const extent = radius + Math.max(...WAVE) * scale;

  return (
    <div
      aria-hidden="true"
      className="relative mx-auto"
      style={{ width: extent * 2, height: extent * 2 }}
    >
      {WAVE.map((height, index) => (
        <span
          key={index}
          data-ring-bar
          // The placement transform lives on this wrapper so the inner span
          // stays free to carry an animation of its own. `origin-top-left` is
          // load-bearing: the wrapper shrink-wraps its bar, so the default
          // centre origin would rotate each bar about its own midpoint and the
          // ring would neither close at twelve o'clock nor grow outward.
          className="absolute left-1/2 top-1/2 origin-top-left"
          style={{ transform: `rotate(${-90 + index * step}deg) translateX(${radius}px)` }}
        >
          <span
            className={`block h-[2px] -translate-y-px ${barClass(height, index)}`}
            style={{ width: height * scale }}
          />
        </span>
      ))}

      {/* A hairline hand, one sweep per 9s loop, parked at twelve under
       * reduced motion. */}
      <span
        data-ring-hand
        className="ring-hand absolute left-1/2 top-1/2 h-px bg-fg/40"
        style={{ width: radius }}
      />

      {/* The only accent event: a mark that flashes for ~3% of the cycle as the
       * wrap passes twelve o'clock. */}
      <span className="ring-seam absolute left-1/2 top-0 -translate-x-1/2 text-[0.6875rem] uppercase tracking-[0.16em] text-accent">
        Tail → head
      </span>
    </div>
  );
}
