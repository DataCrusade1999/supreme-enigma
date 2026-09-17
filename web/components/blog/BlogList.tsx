import Link from "next/link";

export type BlogListPost = {
  slug: string;
  title: string;
  date: string;
  summary: string;
  tags: readonly string[];
};

export function BlogList({ posts }: { posts: BlogListPost[] }) {
  return (
    <ul className="mt-10">
      {posts.map((post) => (
        // Same row rhythm as /projects: the title's Link stretches over the
        // whole row with `after:inset-0`, so the accessible name stays the post
        // title rather than swallowing the summary and tags.
        <li key={post.slug} className="group relative border-b border-line">
          <span
            aria-hidden="true"
            className="absolute inset-0 origin-left scale-x-0 bg-accent/10 transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
          />
          <div className="relative grid grid-cols-12 gap-6 py-7 transition-[padding] duration-200 ease-out group-hover:pl-3 motion-reduce:transition-none">
            <p className="col-span-12 text-xs uppercase tracking-[0.14em] tabular-nums text-accent md:col-span-2">
              {post.date}
            </p>

            <div className="col-span-12 md:col-span-7 md:col-start-3">
              <h2 className="font-display text-3xl leading-tight md:text-[2rem]">
                <Link
                  href={`/blog/${post.slug}`}
                  className="after:absolute after:inset-0 after:content-['']"
                >
                  {post.title}
                </Link>
              </h2>
              <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-muted">
                {post.summary}
              </p>
            </div>

            {post.tags.length > 0 && (
              <ul className="col-span-12 flex flex-wrap gap-3 text-xs uppercase tracking-[0.14em] text-muted md:col-span-3 md:col-start-10 md:justify-end">
                {post.tags.map((tag) => (
                  <li key={tag}>#{tag}</li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
