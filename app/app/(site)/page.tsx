import Link from "next/link";
import { barClass, WAVE } from "../../content/wave-envelope";

// The three numbers the deployed pipeline actually runs on, quoted from
// lambda/src/looper/: pipeline.py's `target_lufs=-14.0` and `top_db=40.0`, and
// crossfade.py's `fade_sec=0.05`.
const SETTINGS = [
  { label: "Loudness target", value: "−14.0 LUFS" },
  { label: "Crossfade", value: "50 ms" },
  { label: "Silence trim", value: "top_db 40" },
];

export default function HomePage() {
  return (
    <div>
      {/* No masthead here — the name is the masthead. */}
      <section>
        <p className="text-xs uppercase tracking-[0.14em] text-muted">
          Software engineer
        </p>
        <h1 className="mt-4 font-display text-[4.125rem] leading-[0.95] md:text-[9.25rem]">
          <span className="block">Ashutosh</span>{" "}
          <span className="block">Pandey</span>
        </h1>
      </section>

      <div className="mt-14 grid grid-cols-12 gap-6">
        <p className="col-span-12 text-base leading-relaxed text-fg/80 md:col-span-5">
          I build small, finished tools end to end — the interface, the signal
          processing underneath it, and the infrastructure it runs on.
        </p>

        <table className="col-span-12 mt-8 w-full border-collapse text-sm md:col-span-5 md:col-start-8 md:mt-0">
          <caption className="border-b border-line pb-2 text-left text-xs uppercase tracking-[0.14em] text-muted">
            Pipeline settings
          </caption>
          <tbody>
            {SETTINGS.map((setting) => (
              <tr key={setting.label} className="border-b border-line">
                <th
                  scope="row"
                  className="py-3 text-left font-normal text-muted"
                >
                  {setting.label}
                </th>
                <td className="py-3 text-right tabular-nums">
                  {setting.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figure className="mt-16">
        {/* Rules, not cards: the bars stand on a 2px baseline rather than
         * sitting inside a bordered box. */}
        <div className="relative flex h-24 items-end gap-[2px] border-b-2 border-rule-heavy sm:h-32">
          {/* The played region, tinted at 10% accent on the same 9s linear
           * clock as the playhead, so both wrap together without a seam. */}
          <span
            aria-hidden="true"
            className="played-tint absolute inset-y-0 left-0 bg-accent/10"
          />
          {WAVE.map((height, index) => (
            <span
              key={index}
              aria-hidden="true"
              data-wave-bar
              // `--bar-index` drives the 8ms-per-bar stagger; the 560ms rise
              // and the stagger itself both live in globals.css.
              style={
                {
                  height: `${height}%`,
                  "--bar-index": index,
                } as React.CSSProperties
              }
              className={`bar-rise relative min-w-px flex-1 ${barClass(height, index)}`}
            />
          ))}
          <span
            aria-hidden="true"
            className="playhead absolute inset-y-0 w-px bg-fg"
          />
        </div>
        <div className="mt-3 flex justify-between text-xs uppercase tracking-[0.14em] text-accent">
          <span>Head</span>
          <span>Tail</span>
        </div>
        <figcaption className="mt-6 max-w-[46ch] text-sm leading-relaxed text-muted">
          The bars at each end are identical: the tail already is the head, so
          the loop closes without a seam. Finding that point in a real track is
          the whole job of BGM Looper.
        </figcaption>
      </figure>

      <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 text-[0.6875rem] uppercase tracking-[0.16em]">
        <Link
          href="/tools/bgm-looper"
          className="group inline-flex min-h-11 items-center gap-2 bg-fg px-3 font-semibold text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
        >
          Open the tool
          <span
            aria-hidden="true"
            className="transition-transform duration-200 ease-out group-hover:translate-x-2 motion-reduce:transition-none"
          >
            →
          </span>
        </Link>
        <Link
          href="/projects"
          className="inline-flex min-h-11 items-center border-b border-line pb-0.5 text-muted transition-colors duration-200 ease-out hover:border-accent hover:text-fg motion-reduce:transition-none"
        >
          All projects
        </Link>
      </div>
    </div>
  );
}
