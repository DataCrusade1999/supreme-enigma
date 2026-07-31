import { resume } from "../../../content/resume";

export default function ResumePage() {
  return (
    <section className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Resume</h1>
        <a
          href="/resume.pdf"
          download
          className="rounded bg-accent px-3 py-1 text-bg hover:opacity-90"
        >
          Download PDF
        </a>
      </div>
      <ol className="mt-6 flex flex-col gap-6 border-l border-fg/10 pl-4">
        {resume.map((entry) => (
          <li key={`${entry.org}-${entry.start}`}>
            <p className="font-semibold">
              {entry.role} · {entry.org}
            </p>
            <p className="text-sm text-fg/60">
              {entry.start} – {entry.end}
            </p>
            <ul className="mt-2 list-disc pl-5 text-fg/80">
              {entry.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
