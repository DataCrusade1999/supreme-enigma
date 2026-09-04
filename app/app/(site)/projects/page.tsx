import Link from "next/link";
import { projects } from "../../../content/projects";
import { PageMasthead } from "../../../components/site/PageMasthead";

export default function ProjectsPage() {
  return (
    <section>
      <PageMasthead eyebrow="Index" title="Projects" />

      <ul className="mt-10">
        {projects.map((project, index) => (
          // The whole row is the target: the name's Link stretches over it with
          // `after:inset-0`, so the accessible name stays the project name
          // rather than swallowing the description.
          <li
            key={project.slug}
            className="group relative border-b border-line"
          >
            {/* A 10% accent wash wiping in from the left, on the same 200ms
             * curve as the indent and the chevron. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 origin-left scale-x-0 bg-accent/10 transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
            />
            <div className="relative grid grid-cols-12 gap-4 py-7 transition-[padding] duration-200 ease-out group-hover:pl-3 motion-reduce:transition-none">
              <span className="col-span-2 text-sm tabular-nums text-muted md:col-span-1">
                {String(index + 1).padStart(2, "0")}
              </span>

              <div className="col-span-10 md:col-span-7">
                <h2 className="font-display text-3xl leading-tight md:text-[2.5rem]">
                  <Link
                    href={`/projects/${project.slug}`}
                    className="after:absolute after:inset-0 after:content-['']"
                  >
                    {project.name}
                  </Link>
                </h2>
                <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-muted">
                  {project.description}
                </p>
              </div>

              <p className="col-span-10 col-start-3 text-xs uppercase tracking-[0.14em] text-muted md:col-span-3 md:col-start-9">
                {project.href}
              </p>

              <span
                aria-hidden="true"
                data-row-chevron
                className="col-span-2 col-start-11 text-right text-xl text-muted transition-transform duration-200 ease-out group-hover:translate-x-2 motion-reduce:transition-none md:col-span-1 md:col-start-12"
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
