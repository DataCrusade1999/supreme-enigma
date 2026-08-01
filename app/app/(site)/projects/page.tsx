import Link from "next/link";
import { projects } from "../../../content/projects";

export default function ProjectsPage() {
  return (
    <section>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
        Index
      </p>
      <h1 className="mt-4 font-mono text-3xl font-semibold tracking-tight">
        Projects
      </h1>

      <ul className="mt-10 flex flex-col">
        {projects.map((project) => (
          <li
            key={project.slug}
            className="group border-t border-line py-7 transition-colors last:border-b hover:border-accent"
          >
            <div className="flex items-baseline gap-3">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 translate-y-[-0.2em] bg-muted/60 transition-colors group-hover:bg-accent"
              />
              <Link
                href={project.href}
                className="font-mono text-xl font-semibold tracking-tight transition-colors group-hover:text-accent"
              >
                {project.name}
              </Link>
            </div>
            <p className="mt-3 max-w-xl pl-[1.125rem] text-[0.9375rem] leading-relaxed text-fg/70">
              {project.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
