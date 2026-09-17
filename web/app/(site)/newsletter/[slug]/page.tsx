import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getReader } from "../../../../lib/keystatic-reader";
import { IssueBody } from "../../../../components/newsletter/IssueBody";
import {
  IssueRail,
  type IssueNeighbour,
} from "../../../../components/newsletter/IssueRail";

export async function generateStaticParams() {
  const reader = getReader();
  const slugs = await reader.collections.newsletter.list();
  return slugs.map((slug) => ({ slug }));
}

export default async function IssuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const reader = getReader();
  const entry = await reader.collections.newsletter.read(slug);
  if (!entry) {
    notFound();
  }
  const mdxSource = await entry.content();

  // Same sort as /newsletter, so "newer" and "older" mean what the archive's
  // ordering says they mean. An issue with no date sorts last under `?? ""`,
  // which is the same fallback the list page uses.
  const all = await reader.collections.newsletter.all();
  const sorted = [...all].sort((a, b) =>
    (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
  );
  const index = sorted.findIndex((candidate) => candidate.slug === slug);

  // index - 1 is the newer issue because the list is descending. A -1 index
  // (the slug is somehow absent from all()) leaves both neighbours null rather
  // than reading off the end of the array.
  const neighbourAt = (position: number): IssueNeighbour | null => {
    if (index < 0) return null;
    const found = sorted[position];
    return found
      ? { slug: found.slug, title: found.entry.title, date: found.entry.date ?? "" }
      : null;
  };

  return (
    <IssueBody
      title={entry.title}
      date={entry.date ?? ""}
      rail={
        <IssueRail
          sentDate={entry.date ?? ""}
          newer={neighbourAt(index - 1)}
          older={neighbourAt(index + 1)}
        />
      }
    >
      <MDXRemote source={mdxSource} />
    </IssueBody>
  );
}
