import Link from "next/link";
import { CommandBar } from "../../../components/site/CommandBar";
import { AccessAdmin } from "../../../components/access/AccessAdmin";

// Owner only: the proxy checks access:manage before this renders.
export default function AccessAdminPage() {
  return (
    <div className="flex min-h-screen flex-col font-ui">
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link href="/tools" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg">
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Tools
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">Access</span>
      </header>
      <main className="flex flex-1 flex-col px-5 py-14 sm:px-10">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Owner</p>
        <h1 className="mt-3 font-display text-5xl leading-[0.95] sm:text-[5.25rem]">Access</h1>
        <div className="mt-5 border-b-2 border-rule-heavy" />
        <p className="mt-[18px] max-w-[52ch] text-base leading-relaxed text-muted">
          Approve people who signed in and wrote to access@ashutosh-pandey.com, and grant them the actions that cost money.
        </p>
        <AccessAdmin />
      </main>
      <CommandBar />
    </div>
  );
}
