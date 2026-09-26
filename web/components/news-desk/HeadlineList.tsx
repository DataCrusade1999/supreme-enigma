import { formatAge } from "../../lib/news-desk/format";
import type { Headline } from "../../lib/news-desk/types";

export function HeadlineList({ headlines, now }: { headlines: Headline[]; now: Date }) {
  return (
    <ul aria-label="Headlines">
      {headlines.map((headline) => (
        <li key={headline.id} className="border-b border-rule py-3">
          {headline.tag !== "Untagged" && headline.tag !== "Drop" && (
            <p className="mb-1 text-[0.6875rem] uppercase tracking-[0.16em] text-accent">{headline.tag}</p>
          )}
          <a
            href={headline.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[0.9375rem] font-semibold leading-snug text-fg hover:text-accent"
          >
            {headline.title}
          </a>
          {headline.summary && (
            <p className="mt-1 text-sm leading-relaxed text-muted">{headline.summary}</p>
          )}
          <p className="mt-1 text-xs text-muted">
            {headline.source} · {formatAge(headline.publishedAt, now)}
          </p>
        </li>
      ))}
    </ul>
  );
}
