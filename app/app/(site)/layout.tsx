import { SiteHeader } from "../../components/site/SiteHeader";
import { SiteFooter } from "../../components/site/SiteFooter";
import { CommandBar } from "../../components/site/CommandBar";
import { GridBackdrop } from "../../components/site/GridBackdrop";

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
      {/* The page margins of the one grid — 40px, 20px under `sm` — live here;
       * GridBackdrop mirrors them to draw the twelve column rules, and each
       * page section declares its own `grid grid-cols-12 gap-6` against them.
       * `isolate` is load-bearing: html carries the page background, so without
       * a stacking context the -z-10 backdrop would paint behind it. */}
      <main className="relative isolate w-full flex-1 px-5 py-14 sm:px-10 sm:py-20">
        <GridBackdrop />
        {children}
      </main>
      <SiteFooter />
      <CommandBar />
    </div>
  );
}
