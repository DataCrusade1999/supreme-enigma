import Link from "next/link";
import type { Project } from "../../content/projects";

// The home page's one call to action, hoisted next to the name so it lands
// above the fold. Rules, not cards: the 2px rule on top is the container —
// there is no box around this block.
export function FeaturedTool({ project }: { project: Project }) {
  return (
    <div className="border-t-2 border-rule-heavy pt-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">
          Featured tool
        </p>
        <span className="text-xs uppercase tracking-[0.14em] text-accent">
          Live
        </span>
      </div>

      <h2 className="mt-3 font-display text-[2.5rem] leading-none md:text-[3.5rem]">
        <Link href={project.href}>{project.name}</Link>
      </h2>

      <p className="mt-4 max-w-[46ch] text-base leading-relaxed text-fg/80">
        {project.description}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-[0.6875rem] uppercase tracking-[0.16em]">
        <Link
          href={project.href}
          className="group inline-flex min-h-11 items-center gap-2 bg-fg px-3 font-semibold text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
        >
          Open the tool
          <span
            aria-hidden="true"
            className="transition-transform duration-200 ease-out group-hover:translate-x-2 motion-reduce:transition-none"
          >
            →
          </span>
        </Link>
        <Link
          href="/projects/bgm-looper#how-it-works"
          className="inline-flex min-h-11 items-center border-b border-line pb-0.5 text-muted transition-colors duration-200 ease-out hover:border-accent hover:text-fg motion-reduce:transition-none"
        >
          How it works
        </Link>
      </div>
    </div>
  );
}
