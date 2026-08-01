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
    <ul className="mt-10 flex flex-col">
      {posts.map((post) => (
        <li
          key={post.slug}
          className="group border-t border-line py-7 transition-colors last:border-b hover:border-accent"
        >
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] tabular-nums text-accent">
            {post.date}
          </p>
          <Link
            href={`/blog/${post.slug}`}
            className="mt-2 block font-mono text-xl font-semibold tracking-tight transition-colors group-hover:text-accent"
          >
            {post.title}
          </Link>
          <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-fg/70">
            {post.summary}
          </p>
          {post.tags.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <li
                  key={tag}
                  className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted"
                >
                  #{tag}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
