import Link from "next/link";
import { getReader } from "../../../lib/keystatic-reader";
import { isButtondownConfigured, isIssueSent } from "../../../lib/buttondown";
import { CommandBar } from "../../../components/site/CommandBar";
import { SendButton } from "../../../components/newsletter/SendButton";

export const dynamic = "force-dynamic";

export default async function NewsletterAdminPage() {
  const reader = getReader();
  const issues = await reader.collections.newsletter.all();
  const sorted = [...issues].sort((a, b) =>
    (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
  );

  // Asked once, before the fan-out. Every per-issue check would throw the same
  // way on an unset key, and the catch below would render each as "status
  // unavailable" — which reads as "not sent yet" and hides a broken
  // integration behind what looks like an empty archive.
  const configured = isButtondownConfigured();

  const withStatus = await Promise.all(
    sorted.map(async ({ slug, entry }) => {
      let sent: boolean | null = null;
      let problem: string | null = null;

      if (!configured) {
        problem = "BUTTONDOWN_API_KEY is not set";
      } else {
        try {
          sent = await isIssueSent(slug);
        } catch {
          // A configured key that still failed is a different problem —
          // Buttondown down, key revoked, network. Says so rather than
          // blaming configuration.
          problem = "Buttondown unreachable";
        }
      }

      return { slug, title: entry.title, date: entry.date ?? "", sent, problem };
    }),
  );

  return (
    <div className="flex min-h-screen flex-col font-ui">
      {/* Same slim header as /tools/resume-admin — the tool pages sit outside
        * the (site) route group, so there is no SiteHeader above them. */}
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg"
        >
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Ashutosh Pandey
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
          Tools / Newsletter admin
        </span>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-6 px-5 py-14 sm:px-10">
        <div className="col-span-12 lg:col-span-8">
          <h1 className="font-display text-3xl leading-[1.15]">Send an issue</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Every archived issue, newest first. Sending emails every current
            Buttondown subscriber and cannot be undone.
          </p>

          <ul className="mt-10">
            {withStatus.map((issue) => (
              <li
                key={issue.slug}
                className="flex items-center justify-between gap-6 border-b border-line py-5"
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] tabular-nums text-accent">
                    {issue.date}
                  </p>
                  <p className="mt-1 font-display text-xl leading-tight">{issue.title}</p>
                </div>
                {issue.sent === true && (
                  <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
                    Sent
                  </span>
                )}
                {issue.sent === false && <SendButton slug={issue.slug} />}
                {issue.problem !== null && (
                  <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-peak">
                    {issue.problem}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </main>

      {/* Not decoration: /tools/* pages render outside the (site) route group
        * and so have no SiteHeader — ⌘K is the only nav they carry. Every other
        * tool page mounts it the same way. It is a client component rendered
        * from a Server Component, which is fine and deliberate. */}
      <CommandBar />
    </div>
  );
}
