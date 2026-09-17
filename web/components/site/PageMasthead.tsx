// Every page opens with this: eyebrow, serif title, a 2px rule beneath, and an
// optional right-hand slot for a single action (the "Open the tool" /
// "Download PDF" bars). The title is always the page's h1.
export function PageMasthead({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="border-b-2 border-rule-heavy pb-5">
      <p className="text-xs uppercase tracking-[0.14em] text-muted">{eyebrow}</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-5xl leading-[0.95] sm:text-[5.25rem]">
          {title}
        </h1>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
    </div>
  );
}
