import { resume } from "../../../content/resume";

export default function ResumePage() {
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
            Timeline
          </p>
          <h1 className="mt-4 font-mono text-3xl font-semibold tracking-tight">
            Resume
          </h1>
        </div>
        <a
          href="/resume.pdf"
          download
          className="bg-accent px-3 py-2 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-bg transition-opacity hover:opacity-85"
        >
          Download PDF
        </a>
      </div>

      <ol className="mt-12 flex flex-col gap-12 border-l border-line">
        {resume.map((entry) => (
          <li key={`${entry.org}-${entry.start}`} className="relative pl-6 sm:pl-8">
            <span
              aria-hidden="true"
              className="absolute left-0 top-[0.5rem] h-px w-4 bg-accent sm:w-6"
            />
            <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] tabular-nums text-accent">
              {entry.start} — {entry.end}
            </p>
            <p className="mt-3 font-mono text-lg font-semibold tracking-tight">
              {entry.role}
            </p>
            <p className="mt-1 font-mono text-sm text-muted">{entry.org}</p>
            <ul className="mt-4 flex max-w-xl flex-col gap-2.5">
              {entry.bullets.map((bullet) => (
                <li
                  key={bullet}
                  className="relative pl-5 text-[0.9375rem] leading-relaxed text-fg/75"
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-[0.65em] h-1 w-1 bg-muted/60"
                  />
                  {bullet}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
