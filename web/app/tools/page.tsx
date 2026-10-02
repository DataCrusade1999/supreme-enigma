import Link from "next/link";
import { CommandBar } from "../../components/site/CommandBar";
import { visibleTools } from "../../lib/authz/visible-tools";

// Outside the `(site)` route group like the tool pages themselves, so it gets
// the root layout and no SiteHeader — the header's nav belongs to the public
// portfolio, and this page is only ever seen from behind the gate.
// The outcome /api/auth/callback passes on after Cognito's passkey page.
const PASSKEY_MESSAGES: Record<string, string> = {
  added: "Passkey added. Use it the next time you sign in.",
  failed: "The passkey was not added.",
};

export default async function ToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { passkey } = await searchParams;
  const passkeyMessage = typeof passkey === "string" ? PASSKEY_MESSAGES[passkey] : undefined;
  const tools = await visibleTools();

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
          The tools this account can open.
        </p>

        {passkeyMessage ? (
          <p role="status" className="mt-6 text-sm text-fg">
            {passkeyMessage}
          </p>
        ) : null}

        <ul className="mt-10 flex flex-col">
          {tools.map((tool) => (
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
          {/* Through sign-in first: Cognito only adds a passkey for a user with
           * a live managed-login session, which outlasts ours by far less. */}
          <a href="/api/auth/login?next=%2Fapi%2Fauth%2Fpasskey" className="text-accent hover:text-fg">
            Add a passkey
          </a>{" "}
          for this device.
        </p>

        <p className="mt-3 text-[0.8125rem] text-muted">
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
