import Link from "next/link";

export type IssueListItem = {
  slug: string;
  title: string;
  date: string;
  summary: string;
};

export function IssueList({ issues }: { issues: IssueListItem[] }) {
  return (
    <ul className="mt-10">
      {issues.map((issue) => (
        // Same row rhythm as /blog and /projects: the title's Link stretches
        // over the whole row with `after:inset-0`, so the accessible name stays
        // the issue title rather than swallowing the summary.
        <li key={issue.slug} className="group relative border-b border-line">
          <span
            aria-hidden="true"
            className="absolute inset-0 origin-left scale-x-0 bg-accent/10 transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
          />
          <div className="relative grid grid-cols-12 gap-6 py-7 transition-[padding] duration-200 ease-out group-hover:pl-3 motion-reduce:transition-none">
            <p className="col-span-12 text-xs uppercase tracking-[0.14em] tabular-nums text-accent md:col-span-2">
              {issue.date}
            </p>

            {/* Spans to column 12 rather than stopping at 9 like BlogList's
              * rows — there is no tag column to leave room for. */}
            <div className="col-span-12 md:col-span-10 md:col-start-3">
              <h2 className="font-display text-3xl leading-tight md:text-[2rem]">
                <Link
                  href={`/newsletter/${issue.slug}`}
                  className="after:absolute after:inset-0 after:content-['']"
                >
                  {issue.title}
                </Link>
              </h2>
              <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-muted">
                {issue.summary}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
