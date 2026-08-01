import { getReader } from "../../../lib/keystatic-reader";
import { BlogList } from "../../../components/blog/BlogList";

export default async function BlogPage() {
  const reader = getReader();
  const posts = await reader.collections.blog.all();
  const sorted = [...posts].sort((a, b) =>
    (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
  );

  return (
    <section>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
        Writing
      </p>
      <h1 className="mt-4 font-mono text-3xl font-semibold tracking-tight">Blog</h1>
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
