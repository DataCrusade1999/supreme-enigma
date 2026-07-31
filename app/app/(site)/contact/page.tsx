const CONTACT_LINKS = [
  {
    label: "Email",
    href: "mailto:ashutosh.pandeyhlr007@gmail.com",
    hint: "ashutosh.pandeyhlr007@gmail.com",
  },
  {
    label: "GitHub",
    href: "https://github.com/your-username",
    hint: "github.com",
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com/in/your-username",
    hint: "linkedin.com",
  },
];

export default function ContactPage() {
  return (
    <section>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
        Channels
      </p>
      <h1 className="mt-4 font-mono text-3xl font-semibold tracking-tight">
        Contact
      </h1>
      <p className="mt-6 max-w-xl text-base leading-relaxed text-fg/80">
        Email is the fastest way to reach me.
      </p>

      <ul className="mt-10 flex flex-col">
        {CONTACT_LINKS.map((link) => (
          <li
            key={link.label}
            className="group flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-line py-5 transition-colors last:border-b hover:border-accent"
          >
            <a
              href={link.href}
              className="font-mono text-lg font-semibold tracking-tight transition-colors group-hover:text-accent"
            >
              {link.label}
            </a>
            <span className="font-mono text-[0.8125rem] break-all text-muted">
              {link.hint}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
