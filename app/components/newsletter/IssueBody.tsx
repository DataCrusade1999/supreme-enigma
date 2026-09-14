export function IssueBody({
  title,
  date,
  rail,
  children,
}: {
  title: string;
  date: string;
  rail?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Reading column. The measure is still capped at max-w-xl (576px) — that
        * is the right length for 15px text, and widening it to fill the page
        * would make the issue harder to read, not easier. What changed is that
        * the column is no longer the only thing on the page. */}
      <article className="col-span-12 lg:col-span-6">
        <p className="text-[0.6875rem] uppercase tracking-[0.16em] tabular-nums text-accent">
          {date}
        </p>
        <h1 className="mt-4 font-display text-4xl leading-tight sm:text-5xl">{title}</h1>
        <div className="mt-10 flex max-w-xl flex-col gap-4 text-[0.9375rem] leading-relaxed text-fg/80">
          {children}
        </div>
      </article>

      {/* Counterweight. Stacks under the body below lg, where there is no spare
        * width to counterweight and the rail is simply the page's tail. */}
      {rail ? (
        <div className="col-span-12 mt-12 lg:col-span-4 lg:col-start-9 lg:mt-0">{rail}</div>
      ) : null}
    </div>
  );
}
