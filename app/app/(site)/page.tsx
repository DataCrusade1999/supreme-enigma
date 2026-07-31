import Link from "next/link";

/*
 * A stylised envelope, not a real analysis. The first and last eight bars are
 * the same eight values, which is what a seamless loop actually looks like:
 * the tail is already the head. Bars over PEAK read as peaks.
 */
const HEAD = [18, 34, 27, 52, 41, 63, 38, 46];
const BODY = [
  30, 47, 71, 55, 82, 61, 44, 58, 73, 49, 36, 66, 88, 70, 52, 39, 57, 80, 62,
  45, 33, 51, 68, 84, 59, 42, 30, 48, 65, 77, 54, 40, 62, 86, 69, 47, 35, 53,
  44, 29,
];
const WAVE = [...HEAD, ...BODY, ...HEAD];
const PEAK = 78;

function barClass(height: number, index: number) {
  if (height >= PEAK) return "bg-peak";
  if (index < HEAD.length || index >= HEAD.length + BODY.length)
    return "bg-accent";
  return "bg-fg/25";
}

export default function HomePage() {
  return (
    <div>
      <section>
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
          Software engineer
        </p>
        <h1 className="mt-4 font-mono text-4xl font-semibold tracking-tight sm:text-5xl">
          Ashutosh Pandey
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-fg/80 sm:text-lg">
          I build small, finished tools end to end — the interface, the signal
          processing underneath it, and the infrastructure it runs on.
        </p>
      </section>

      <figure className="mt-16">
        <div className="border border-line bg-surface px-4 py-6 sm:px-6 sm:py-8">
          <div className="relative flex h-24 items-center gap-[2px] sm:h-32">
            {WAVE.map((height, index) => (
              <span
                key={index}
                aria-hidden="true"
                style={{ height: `${height}%` }}
                className={`min-w-px flex-1 ${barClass(height, index)}`}
              />
            ))}
            <span
              aria-hidden="true"
              className="playhead absolute inset-y-0 w-px bg-fg"
            />
          </div>
        </div>
        <figcaption className="mt-4 font-mono text-[0.6875rem] leading-relaxed tracking-[0.04em] text-muted">
          <span
            aria-hidden="true"
            className="mr-2 inline-block h-2 w-2 bg-accent align-middle"
          />
          The bars at each end are identical: the tail already is the head, so
          the loop closes without a seam. Finding that point in a real track is
          the whole job of BGM Looper.
        </figcaption>
      </figure>

      <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 font-mono text-[0.6875rem] uppercase tracking-[0.16em]">
        <Link
          href="/tools/bgm-looper"
          className="bg-accent px-3 py-2 font-semibold text-bg transition-opacity hover:opacity-85"
        >
          Open the tool
        </Link>
        <Link
          href="/projects"
          className="border-b border-line pb-0.5 text-muted transition-colors hover:border-accent hover:text-fg"
        >
          All projects
        </Link>
      </div>
    </div>
  );
}
