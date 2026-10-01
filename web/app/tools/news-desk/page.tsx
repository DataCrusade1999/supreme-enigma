import Link from "next/link";
import { CommandBar } from "../../../components/site/CommandBar";
import { NewsDesk } from "../../../components/news-desk/NewsDesk";
import { isStorageConfigured, readSnapshot } from "@/lib/news-desk/store";
import type { Snapshot } from "@/lib/news-desk/types";

export const dynamic = "force-dynamic";

export default async function NewsDeskPage() {
  let initial: Snapshot | null = null;
  let problem: string | null = null;

  if (!isStorageConfigured()) {
    problem = "Storage is not configured here (S3_BUCKET_NAME is unset), so nothing can be saved.";
  } else {
    try {
      initial = await readSnapshot();
    } catch (err) {
      // Logged, because an IAM change is otherwise indistinguishable from a
      // corrupt file on the page. A corrupt file is repaired by the next Refresh.
      console.error("news-desk: could not read the snapshot", err);
      problem = "Could not read the saved headlines. Refresh to try again.";
    }
  }

  return (
    <div className="flex min-h-screen flex-col font-ui">
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg">
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Ashutosh Pandey
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">Tools / News Desk</span>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-6 px-5 py-14 sm:px-10">
        <div className="col-span-12">
          <h1 className="font-display text-3xl leading-[1.15]">News Desk</h1>
          <div className="lg:w-2/3">
            <p className="mt-4 mb-8 text-sm leading-relaxed text-muted">
              Indian economy, reforms and legislation, from 13 free sources. Refresh fetches
              everything again; nothing updates on its own.
            </p>
          </div>
          <NewsDesk initial={initial} problem={problem} nowIso={new Date().toISOString()} />
        </div>
      </main>

      <CommandBar />
    </div>
  );
}
