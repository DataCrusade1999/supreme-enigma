import Link from "next/link";
import { projects } from "../../../content/projects";

export default function ProjectsPage() {
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Projects</h1>
      <ul className="mt-6 flex flex-col gap-4">
        {projects.map((project) => (
          <li key={project.slug} className="rounded border border-fg/10 p-4">
            <Link href={project.href} className="text-lg font-semibold hover:text-accent">
              {project.name}
            </Link>
            <p className="mt-2 text-fg/70">{project.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
