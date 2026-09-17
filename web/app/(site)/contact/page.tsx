import { PageMasthead } from "../../../components/site/PageMasthead";

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
      <PageMasthead eyebrow="Channels" title="Contact" />

      <p className="mt-8 max-w-[46ch] text-base leading-relaxed text-muted">
        Email is the fastest way to reach me.
      </p>

      <ul className="mt-10">
        {CONTACT_LINKS.map((link) => (
          // Same row rhythm as /projects and /blog: the label's anchor stretches
          // over the row with `after:inset-0`, so the accessible name stays the
          // channel name rather than swallowing the address.
          <li key={link.label} className="group relative border-b border-line">
            <span
              aria-hidden="true"
              className="absolute inset-0 origin-left scale-x-0 bg-accent/10 transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
            />
            <div className="relative grid grid-cols-12 items-baseline gap-6 py-5 transition-[padding] duration-200 ease-out group-hover:pl-3 motion-reduce:transition-none">
              <p className="col-span-12 md:col-span-2">
                <a
                  href={link.href}
                  className="inline-flex min-h-11 items-center text-xs uppercase tracking-[0.14em] text-muted transition-colors duration-200 ease-out after:absolute after:inset-0 after:content-[''] group-hover:text-fg motion-reduce:transition-none"
                >
                  {link.label}
                </a>
              </p>

              <span className="col-span-12 break-all font-display text-[2.125rem] leading-tight md:col-span-8 md:col-start-3">
                {link.hint}
              </span>

              <span
                aria-hidden="true"
                data-row-chevron
                className="col-span-12 text-xl text-muted transition-transform duration-200 ease-out group-hover:translate-x-2 motion-reduce:transition-none md:col-span-2 md:col-start-11 md:text-right"
              >
                →
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
