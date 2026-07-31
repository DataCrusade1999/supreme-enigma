export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-5 py-6 font-mono text-[0.6875rem] tracking-[0.08em] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>© {new Date().getFullYear()} Ashutosh Pandey</p>
        <p className="uppercase tracking-[0.16em]">
          next · vercel · aws lambda · python dsp
        </p>
      </div>
    </footer>
  );
}
