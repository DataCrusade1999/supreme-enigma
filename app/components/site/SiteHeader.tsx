import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/projects", label: "Projects" },
  { href: "/resume", label: "Resume" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Link
          href="/"
          className="group flex items-center gap-2.5 font-mono text-sm font-semibold tracking-tight text-fg"
        >
          <span
            aria-hidden="true"
            className="h-3.5 w-1 shrink-0 bg-accent transition-transform duration-200 group-hover:scale-y-150"
          />
          Ashutosh Pandey
        </Link>

        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em]">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="border-b border-transparent pb-0.5 text-muted transition-colors hover:border-accent hover:text-fg"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/tools/bgm-looper"
            className="bg-accent px-2.5 py-1.5 font-semibold text-bg transition-opacity hover:opacity-85"
          >
            BGM Looper
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
