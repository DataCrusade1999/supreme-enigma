import { LoopRing } from "../../../components/site/LoopRing";
import { PageMasthead } from "../../../components/site/PageMasthead";
import { getPublishedResume } from "../../../lib/resume-content";

// Bracketed placeholders, deliberately: the repo's own About copy is still the
// scaffold's, and writing it is separate work. See the design spec §8.
const META = [
  { label: "Based in", value: "[City, Country]" },
  { label: "Currently", value: "[What you are working on]" },
  { label: "Working with", value: "[Your stack]" },
];

export default async function AboutPage() {
  const { resume } = await getPublishedResume();

  return (
    <section>
      <PageMasthead eyebrow="Background" title="About" />

      <div className="mt-14 grid grid-cols-12 gap-6">
        <div className="col-span-12 md:col-span-6">
          <p className="font-display text-3xl leading-[1.15] md:text-[2.5rem]">
            {resume.headline.title}
          </p>
          <p className="mt-8 text-base leading-relaxed text-fg/80">
            {resume.headline.summary}
          </p>
          <p className="mt-5 text-base leading-relaxed text-fg/80">
            [A second paragraph: how you got here, and what you are looking for
            next.]
          </p>
        </div>

        {/* The right-hand column is the mark, not a portrait: the home page's
         * own envelope wrapped into a circle. */}
        <div className="col-span-12 md:col-span-5 md:col-start-8">
          <LoopRing />
          <dl className="mt-10 border-t border-line text-sm">
            {META.map((item) => (
              <div
                key={item.label}
                className="flex items-baseline justify-between gap-6 border-b border-line py-3"
              >
                <dt className="text-xs uppercase tracking-[0.14em] text-muted">
                  {item.label}
                </dt>
                <dd className="text-right">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
