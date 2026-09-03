import { SiteHeader } from "../../components/site/SiteHeader";
import { SiteFooter } from "../../components/site/SiteFooter";
import { CommandBar } from "../../components/site/CommandBar";

// CommandBar (and the ⌘K trigger/shortcut) is intentionally scoped to the
// public portfolio pages in this route group, not site-wide — the gated
// /tools/bgm-looper section has its own layout (app/layout.tsx only, no
// SiteHeader) and isn't meant to inherit this secondary nav path. See
// docs/superpowers/specs/2026-08-04-portfolio-terminal-layer-design.md §7.
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col font-ui">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14 sm:px-8 sm:py-20">
        {children}
      </main>
      <SiteFooter />
      <CommandBar />
    </div>
  );
}
