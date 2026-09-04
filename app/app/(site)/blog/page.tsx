import { getReader } from "../../../lib/keystatic-reader";
import { BlogList } from "../../../components/blog/BlogList";
import { PageMasthead } from "../../../components/site/PageMasthead";

export default async function BlogPage() {
  const reader = getReader();
  const posts = await reader.collections.blog.all();
  const sorted = [...posts].sort((a, b) =>
    (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
  );

  return (
    <section>
      <PageMasthead eyebrow="Writing" title="Blog" />
      <BlogList
        posts={sorted.map(({ slug, entry }) => ({
          slug,
          title: entry.title,
          date: entry.date ?? "",
          summary: entry.summary,
          tags: entry.tags,
        }))}
      />
    </section>
  );
}
