import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// A fixture entry with `demoGif` set, alongside the real ones. The repo's own
// bgm-looper entry deliberately leaves the field unset (design spec §8), so
// the "GIF present" case needs a project that has it.
vi.mock("../../../../content/projects", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../content/projects")>();
  return {
    ...actual,
    projects: [
      ...actual.projects,
      {
        slug: "with-gif",
        name: "With Gif",
        description: "A fixture project that has a demo recording.",
        href: "/tools/with-gif",
        demoGif: "/demos/with-gif.gif",
      },
    ],
  };
});

const { projects } = await import("../../../../content/projects");
const { default: ProjectDetailPage, generateStaticParams } = await import("./page");

describe("ProjectDetailPage", () => {
  it("generates one static param per project", async () => {
    await expect(generateStaticParams()).resolves.toEqual(
      projects.map((project) => ({ slug: project.slug })),
    );
  });

  it("calls notFound() for an unknown slug", async () => {
    // notFound() throws Next's 404 fallback error; matching on it keeps this
    // from passing on an unrelated throw.
    await expect(
      ProjectDetailPage({ params: Promise.resolve({ slug: "does-not-exist" }) }),
    ).rejects.toThrow(/404/);
  });

  it("titles the page with the project name and links out to the tool", async () => {
    render(await ProjectDetailPage({ params: Promise.resolve({ slug: "bgm-looper" }) }));

    expect(
      screen.getByRole("heading", { level: 1, name: "BGM Looper" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the tool/ })).toHaveAttribute(
      "href",
      "/tools/bgm-looper",
    );
    expect(screen.getByRole("link", { name: /All projects/ })).toHaveAttribute(
      "href",
      "/projects",
    );
  });

  it("lists the four pipeline steps in the order the pipeline runs them", async () => {
    render(await ProjectDetailPage({ params: Promise.resolve({ slug: "bgm-looper" }) }));

    const steps = within(
      screen.getByRole("list", { name: "How it works" }),
    ).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining("top_db 40"),
      expect.stringContaining("−14.0 LUFS"),
      expect.stringContaining("Beat-aligned loop point"),
      expect.stringContaining("50 ms"),
    ]);
  });

  it("renders the demo GIF when the project sets one", async () => {
    render(await ProjectDetailPage({ params: Promise.resolve({ slug: "with-gif" }) }));

    const gif = screen.getByRole("img", { name: "With Gif demo" });
    expect(gif).toHaveAttribute("src", "/demos/with-gif.gif");
    // Above the fold, so it must not be lazy — it may be the page's LCP.
    expect(gif).not.toHaveAttribute("loading", "lazy");
  });

  it("omits the demo section entirely when the project has no GIF", async () => {
    render(await ProjectDetailPage({ params: Promise.resolve({ slug: "bgm-looper" }) }));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
