import { resume } from "../../../content/resume";
import { PageMasthead } from "../../../components/site/PageMasthead";

export default function ResumePage() {
  return (
    <section>
      <PageMasthead
        eyebrow="Timeline"
        title="Resume"
        right={
          <a
            href="/resume.pdf"
            download
            className="group inline-flex min-h-11 items-center gap-2 bg-fg px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
          >
            Download PDF
            <span
              aria-hidden="true"
              className="transition-transform duration-200 ease-out group-hover:translate-x-2 motion-reduce:transition-none"
            >
              →
            </span>
          </a>
        }
      />

      <ol className="mt-10">
        {resume.map((entry) => (
          <li
            key={`${entry.org}-${entry.start}`}
            className="grid grid-cols-12 gap-6 border-b border-line py-7"
          >
            <p className="col-span-12 text-xs uppercase tracking-[0.14em] tabular-nums text-accent md:col-span-2">
              {entry.start} — {entry.end}
            </p>

            <div className="col-span-12 md:col-span-6 md:col-start-3">
              <p className="text-base font-medium">{entry.role}</p>
              <p className="mt-1 text-sm text-muted">{entry.org}</p>
            </div>

            <ul className="col-span-12 flex flex-col gap-2.5 md:col-span-4 md:col-start-9">
              {entry.bullets.map((bullet) => (
                <li key={bullet} className="text-sm leading-relaxed text-muted">
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
