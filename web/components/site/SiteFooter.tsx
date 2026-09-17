const STACK = ["next", "vercel", "aws lambda", "python dsp"];

export function SiteFooter() {
  return (
    <footer className="border-t-2 border-rule-heavy">
      <div className="mx-auto flex w-full flex-col gap-4 px-5 py-6 text-[0.6875rem] tracking-[0.08em] text-muted sm:flex-row-reverse sm:items-center sm:justify-between sm:gap-2 sm:px-10">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 uppercase tracking-[0.16em]">
          {STACK.map((item) => (
            <li
              key={item}
              // The interpunct is drawn between items rather than baked into a
              // single string, so the list can wrap at any width.
              className="before:mr-3 before:text-line before:content-['·'] first:before:hidden"
            >
              {item}
            </li>
          ))}
        </ul>
        {/* Under `sm` the copyright sits centred beneath its own hairline. */}
        <p className="border-t border-line pt-4 text-center sm:border-t-0 sm:pt-0 sm:text-left">
          © {new Date().getFullYear()} Ashutosh Pandey
        </p>
      </div>
    </footer>
  );
}
