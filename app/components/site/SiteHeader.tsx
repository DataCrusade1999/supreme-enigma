import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/projects", label: "Projects" },
  { href: "/resume", label: "Resume" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b-2 border-rule-heavy bg-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <Link
          href="/"
          className="group flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg"
        >
          <span
            aria-hidden="true"
            className="h-3.5 w-1 shrink-0 bg-accent transition-transform duration-200 ease-out group-hover:scale-y-150 motion-reduce:transition-none"
          />
          Ashutosh Pandey
        </Link>

        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.6875rem] uppercase tracking-[0.16em]">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              // The 44px hit target is the link box; the inner span keeps the
              // underline on the baseline instead of the bottom of that box.
              className="group inline-flex min-h-11 items-center text-muted transition-colors duration-200 ease-out hover:text-fg motion-reduce:transition-none"
            >
              {/* The underline wipes in from the left on scaleX rather than
               * fading a border — one rule, no SVG per link. Spec §6. */}
              <span className="relative pb-0.5 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-200 after:ease-out group-hover:after:scale-x-100 motion-reduce:after:transition-none">
                {link.label}
              </span>
            </Link>
          ))}

          <span aria-hidden="true" className="hidden h-4 w-px bg-line sm:block" />

          <ThemeToggle />

          <Link
            href="/tools/bgm-looper"
            className="inline-flex min-h-11 items-center bg-fg px-3 font-semibold text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
          >
            BGM Looper
          </Link>
        </nav>
      </div>
    </header>
  );
}
