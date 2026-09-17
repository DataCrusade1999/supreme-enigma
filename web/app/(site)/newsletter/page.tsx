import { getReader } from "../../../lib/keystatic-reader";
import { IssueList } from "../../../components/newsletter/IssueList";
import { SubscribeForm } from "../../../components/newsletter/SubscribeForm";
import { PageMasthead } from "../../../components/site/PageMasthead";

export default async function NewsletterPage() {
  const reader = getReader();
  const issues = await reader.collections.newsletter.all();
  const sorted = [...issues].sort((a, b) =>
    (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
  );

  return (
    <section>
      {/* Every page opens with this component and its title is the page's h1 —
        * web/app/(site)/blog/page.tsx is the pattern this mirrors. */}
      <PageMasthead eyebrow="Writing" title="Newsletter" />
      <IssueList
        issues={sorted.map(({ slug, entry }) => ({
          slug,
          title: entry.title,
          date: entry.date ?? "",
          summary: entry.summary,
        }))}
      />
      <SubscribeForm />
    </section>
  );
}
