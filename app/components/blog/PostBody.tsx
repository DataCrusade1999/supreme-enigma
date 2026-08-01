export function PostBody({
  title,
  date,
  children,
}: {
  title: string;
  date: string;
  children: React.ReactNode;
}) {
  return (
    <article>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] tabular-nums text-accent">
        {date}
      </p>
      <h1 className="mt-4 font-mono text-3xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-10 flex max-w-xl flex-col gap-4 text-[0.9375rem] leading-relaxed text-fg/80">
        {children}
      </div>
    </article>
  );
}
