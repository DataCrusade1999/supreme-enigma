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
    <header className="flex items-center justify-between border-b border-fg/10 px-6 py-4">
      <Link href="/" className="font-bold">
        Ashutosh Pandey
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="hover:text-accent">
            {link.label}
          </Link>
        ))}
        <Link
          href="/tools/bgm-looper"
          className="rounded bg-accent px-3 py-1 text-bg hover:opacity-90"
        >
          BGM Looper
        </Link>
        <ThemeToggle />
      </nav>
    </header>
  );
}
