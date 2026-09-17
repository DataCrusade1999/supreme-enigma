import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getReader } from "../../../../lib/keystatic-reader";
import { PostBody } from "../../../../components/blog/PostBody";

export async function generateStaticParams() {
  const reader = getReader();
  const slugs = await reader.collections.blog.list();
  return slugs.map((slug) => ({ slug }));
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const reader = getReader();
  const entry = await reader.collections.blog.read(slug);
  if (!entry) {
    notFound();
  }
  const mdxSource = await entry.content();

  return (
    <PostBody title={entry.title} date={entry.date ?? ""}>
      <MDXRemote source={mdxSource} />
    </PostBody>
  );
}
