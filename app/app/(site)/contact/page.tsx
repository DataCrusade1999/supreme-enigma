const CONTACT_LINKS = [
  { label: "Email", href: "mailto:ashutosh.pandeyhlr007@gmail.com" },
  { label: "GitHub", href: "https://github.com/your-username" },
  { label: "LinkedIn", href: "https://linkedin.com/in/your-username" },
];

export default function ContactPage() {
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Contact</h1>
      <ul className="mt-6 flex flex-col gap-2">
        {CONTACT_LINKS.map((link) => (
          <li key={link.label}>
            <a href={link.href} className="hover:text-accent">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
