import Link from "next/link";
import { SubscribeForm } from "./SubscribeForm";

export type IssueNeighbour = {
  slug: string;
  title: string;
  date: string;
};

export function IssueRail({
  sentDate,
  newer,
  older,
}: {
  sentDate: string;
  newer: IssueNeighbour | null;
  older: IssueNeighbour | null;
}) {
  const neighbours = [
    { label: "Newer", issue: newer },
    { label: "Older", issue: older },
  ].filter((entry): entry is { label: string; issue: IssueNeighbour } =>
    entry.issue !== null,
  );

  return (
    <div>
      {/* No issue number here, deliberately. The content schema is
        * title/date/summary/content and nothing else, and deriving a number
        * from position in the sorted list would renumber every issue the
        * moment one was deleted. The send date is a real field, and it is the
        * fact a reader wants in this slot: this was an email before it was a
        * page. */}
      <div className="border-t-2 border-rule-heavy pt-5">
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          Emailed to subscribers on{" "}
          <span className="tabular-nums text-fg">{sentDate}</span>, and archived
          here the same day.
        </p>
      </div>

      {neighbours.length > 0 && (
        <div className="mt-8 border-t border-line pt-5">
          <p className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
            More issues
          </p>
          <ul className="mt-4">
            {neighbours.map(({ label, issue }) => (
              <li key={issue.slug} className="border-b border-line py-3.5">
                <p className="text-[0.6875rem] uppercase tracking-[0.14em] tabular-nums text-accent">
                  {issue.date} · {label}
                </p>
                <Link
                  href={`/newsletter/${issue.slug}`}
                  className="mt-1.5 block font-display text-xl leading-tight"
                >
                  {issue.title}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href="/newsletter"
            className="mt-4 inline-flex min-h-11 items-center text-[0.6875rem] uppercase tracking-[0.16em] text-muted transition-colors duration-200 ease-out hover:text-fg motion-reduce:transition-none"
          >
            <span className="border-b border-accent pb-0.5">All issues →</span>
          </Link>
        </div>
      )}

      <SubscribeForm variant="rail" />
    </div>
  );
}
