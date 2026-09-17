import { getObjectBytes } from "../../../../../lib/aws";
import { draftJsonKey, resumeBucket } from "../../../../../lib/resume-keys";
import { resumeSchema } from "../../../../../lib/resume-schema";

// Always fresh: a draft changes on every save, and a cached preview showing
// the previous correction is worse than no preview.
export const dynamic = "force-dynamic";

export default async function DraftPreviewPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;

  let content;
  try {
    const bytes = await getObjectBytes(resumeBucket(), draftJsonKey(draftId));
    content = resumeSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    return (
      <main className="px-5 py-14 sm:px-10">
        <p className="text-sm text-peak">
          No readable draft for that id. Extract one first.
        </p>
      </main>
    );
  }

  return (
    <main className="px-5 py-14 sm:px-10">
      <p className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
        Preview — not published
      </p>
      <h1 className="mt-4 font-display text-4xl leading-[1.1]">
        {content.headline.name}
      </h1>
      <p className="mt-2 text-base text-muted">{content.headline.title}</p>
      <p className="mt-6 max-w-2xl text-base leading-relaxed text-fg/80">
        {content.headline.summary}
      </p>

      <ol className="mt-12">
        {content.work.map((entry) => (
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

      <dl className="mt-12 border-t border-line">
        {content.skills.map((group) => (
          <div
            key={group.group}
            className="grid grid-cols-12 gap-6 border-b border-line py-5"
          >
            <dt className="col-span-12 text-xs uppercase tracking-[0.14em] text-muted md:col-span-2">
              {group.group}
            </dt>
            <dd className="col-span-12 text-sm md:col-span-10">
              {group.items.join(" · ")}
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
