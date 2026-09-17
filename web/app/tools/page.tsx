import Link from "next/link";
import { CommandBar } from "../../components/site/CommandBar";
import { TOOLS } from "../../lib/route-gate";

// Outside the `(site)` route group like the tool pages themselves, so it gets
// the root layout and no SiteHeader — the header's nav belongs to the public
// portfolio, and this page is only ever seen from behind the gate.
export default function ToolsPage() {
  return (
    <div className="flex min-h-screen flex-col font-ui">
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg"
        >
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Ashutosh Pandey
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
          Tools
        </span>
      </header>

      <main className="flex flex-1 flex-col px-5 py-14 sm:px-10">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Private</p>
        <h1 className="mt-3 font-display text-5xl leading-[0.95] sm:text-[5.25rem]">
          Tools
        </h1>
        <div className="mt-5 border-b-2 border-rule-heavy" />

        <p className="mt-[18px] max-w-[46ch] text-base leading-relaxed text-muted">
          Everything the one shared password opens. You are through the gate for
          this session.
        </p>

        <ul className="mt-10 flex flex-col">
          {TOOLS.map((tool) => (
            <li key={tool.href} className="border-b border-line">
              <Link
                href={tool.href}
                className="group grid grid-cols-12 items-baseline gap-x-6 gap-y-2 py-7"
              >
                <span className="col-span-12 text-xs uppercase tracking-[0.14em] text-accent md:col-span-2">
                  {tool.kind}
                </span>

                <span className="col-span-12 md:col-span-6 md:col-start-3">
                  <span className="block text-base font-medium tracking-tight">
                    {tool.name}
                  </span>
                  <span className="mt-1.5 block text-sm leading-relaxed text-muted">
                    {tool.blurb}
                  </span>
                </span>

                <span className="col-span-12 flex items-center gap-2.5 text-[0.6875rem] uppercase tracking-[0.16em] text-muted md:col-span-4 md:col-start-9 md:justify-end">
                  {tool.href}
                  {/* Same left-anchored nudge the site's other forward links
                   * use, so a row reads as a destination rather than a card. */}
                  <span
                    aria-hidden="true"
                    className="text-accent transition-transform duration-200 ease-out group-hover:translate-x-1.5 motion-reduce:transition-none"
                  >
                    →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-9 text-[0.8125rem] text-muted">
          Back to the{" "}
          <Link href="/" className="text-accent hover:text-fg">
            public site
          </Link>
          .
        </p>
      </main>

      {/* The tool pages each render their own, and this page is one more place
        * the ⌘K rows are the fastest way across. */}
      <CommandBar />
    </div>
  );
}
