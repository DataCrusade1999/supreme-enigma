type TerminalWindowProps = {
  title: string;
  children: React.ReactNode;
};

export function TerminalWindow({ title, children }: TerminalWindowProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="flex items-center gap-1.5 bg-[var(--color-terminal-bg)] px-3 py-2">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="ml-2 font-mono text-[0.6875rem] text-[var(--color-terminal-fg)]/60">
          {title}
        </span>
      </div>
      <div className="bg-[var(--color-terminal-bg)] px-4 py-4 font-mono text-sm text-[var(--color-terminal-fg)]">
        {children}
      </div>
    </div>
  );
}
