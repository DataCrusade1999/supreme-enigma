import Link from "next/link";
import { projects } from "../../../content/projects";
import { TerminalWindow } from "../../../components/site/TerminalWindow";

export default function ProjectsPage() {
  return (
    <section>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
        Index
      </p>
      <h1 className="mt-4 font-mono text-3xl font-semibold tracking-tight">
        Projects
      </h1>

      <div className="mt-10">
        <TerminalWindow title="projects — zsh">
          <p className="text-[var(--color-accent)]">$ ls</p>
          <ul className="mt-3 flex flex-col gap-5">
            {projects.map((project) => (
              <li key={project.slug}>
                <div className="flex items-baseline gap-2">
                  <span aria-hidden="true" className="text-[var(--color-accent)]">
                    $
                  </span>
                  <Link
                    href={project.href}
                    className="text-base font-semibold text-[var(--color-terminal-fg)] transition-colors hover:text-[var(--color-accent)]"
                  >
                    {project.name}
                  </Link>
                </div>
                <p className="mt-1 pl-4 text-[0.8125rem] leading-relaxed text-[var(--color-terminal-fg)]/70">
                  {project.description}
                </p>
              </li>
            ))}
          </ul>
        </TerminalWindow>
      </div>
    </section>
  );
}
