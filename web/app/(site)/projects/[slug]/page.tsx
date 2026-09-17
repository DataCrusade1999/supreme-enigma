import Link from "next/link";
import { notFound } from "next/navigation";
import { projects } from "../../../../content/projects";
import { PageMasthead } from "../../../../components/site/PageMasthead";
import { ProjectDemoGif } from "../../../../components/site/ProjectDemoGif";

// The pipeline's real order, read from lambda/src/looper/: pipeline.py runs
// trim_silence(top_db=40.0) → normalize_loudness(target_lufs=-14.0) →
// find_loop_point (librosa beat tracking) → crossfade_loop, whose fade_sec
// defaults to 0.05 and whose sin/cos ramps make it equal-power.
const STEPS = [
  {
    title: "Trim at top_db 40",
    detail: "Leading and trailing near-silence comes off before anything else.",
  },
  {
    title: "Normalize to −14.0 LUFS",
    detail: "One loudness target, so every track comes back at the same level.",
  },
  {
    title: "Beat-aligned loop point",
    detail:
      "Beat-tracked candidates are scored on how well the tail matches the head.",
  },
  {
    title: "50 ms equal-power crossfade",
    detail: "Sine/cosine ramps blend the tail into the head at constant power.",
  },
];

// No `Project` field backs these yet, and this task adds only `demoGif` — they
// are page constants quoted from the repo the way the home page quotes its
// pipeline settings. They become fields when a second project exists.
const BUILT_WITH = ["Next.js", "TypeScript", "Python 3.12", "AWS Lambda", "S3"];

const SETTINGS = [
  { label: "Loudness target", value: "−14.0 LUFS" },
  { label: "Crossfade", value: "50 ms" },
  { label: "Silence trim", value: "top_db 40" },
];

export async function generateStaticParams() {
  return projects.map((project) => ({ slug: project.slug }));
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = projects.find((entry) => entry.slug === slug);
  if (!project) {
    notFound();
  }

  return (
    <article>
      <Link
        href="/projects"
        className="group inline-flex min-h-11 items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted transition-colors duration-200 ease-out hover:text-fg motion-reduce:transition-none"
      >
        <span
          aria-hidden="true"
          className="transition-transform duration-200 ease-out group-hover:-translate-x-2 motion-reduce:transition-none"
        >
          ←
        </span>
        All projects
      </Link>

      <div className="mt-6">
        <PageMasthead
          eyebrow="Project"
          title={project.name}
          right={
            <Link
              href={project.href}
              className="group inline-flex min-h-11 items-center gap-2 bg-fg px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
            >
              Open the tool
              <span
                aria-hidden="true"
                className="transition-transform duration-200 ease-out group-hover:translate-x-2 motion-reduce:transition-none"
              >
                →
              </span>
            </Link>
          }
        />
      </div>

      <div className="mt-12 grid grid-cols-12 gap-6">
        {/* Omitted, not stubbed, while the recording does not exist — the
         * columns either side keep their place so nothing shifts when it
         * lands. Design spec §8. */}
        {project.demoGif ? (
          <div className="col-span-12 md:col-span-8">
            <ProjectDemoGif
              src={project.demoGif}
              alt={`${project.name} demo`}
              width={1280}
              height={720}
              priority
            />
          </div>
        ) : null}

        <div className="col-span-12 mt-8 md:col-span-3 md:col-start-10 md:mt-0">
          <p className="border-b border-line pb-2 text-xs uppercase tracking-[0.14em] text-muted">
            Built with
          </p>
          <ul className="text-sm">
            {BUILT_WITH.map((item) => (
              <li key={item} className="border-b border-line py-3">
                {item}
              </li>
            ))}
          </ul>

          <p className="mt-8 border-b border-line pb-2 text-xs uppercase tracking-[0.14em] text-muted">
            Settings
          </p>
          <dl className="text-sm">
            {SETTINGS.map((setting) => (
              <div
                key={setting.label}
                className="flex items-baseline justify-between gap-4 border-b border-line py-3"
              >
                <dt className="text-muted">{setting.label}</dt>
                <dd className="text-right tabular-nums">{setting.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="mt-14 grid grid-cols-12 gap-6">
        <p className="col-span-12 text-base leading-relaxed text-fg/80 md:col-span-5">
          {project.description}
        </p>

        <div className="col-span-12 mt-10 md:col-span-6 md:col-start-7 md:mt-0">
          <p
            id="how-it-works"
            className="border-b-2 border-rule-heavy pb-2 text-xs uppercase tracking-[0.14em] text-muted"
          >
            How it works
          </p>
          <ol aria-labelledby="how-it-works">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="grid grid-cols-12 gap-4 border-b border-line py-5"
              >
                <span className="col-span-2 text-sm tabular-nums text-accent">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="col-span-10">
                  <p className="font-display text-2xl leading-tight">{step.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {step.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </article>
  );
}
