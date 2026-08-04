# Portfolio Motion & GIFs (UI Overhaul Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/projects/[slug]` detail page that can show a priority-aware demo GIF, point the `/projects` list at it instead of linking straight out to the tool, and add three small SVG micro-interactions (nav underline, project-row chevron, theme-toggle icon morph) — closing out the UI overhaul with a final cross-cutting perf/a11y verification pass (the former "Phase 5").

**Architecture:** One new content field (`Project.demoGif`), one new presentational component (`ProjectDemoGif`, plain `<img>` with a `priority` prop controlling `loading`), one new route (`/projects/[slug]`), and three targeted edits to existing components for the SVG micro-interactions — all pure CSS/SVG, gated on `prefers-reduced-motion` via Tailwind's `motion-reduce:` variant, no new global CSS needed.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS v4 (`motion-reduce:`/`group-hover:` variants, arbitrary-property syntax for SVG stroke animation). No new dependencies.

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-08-04-portfolio-motion-gifs-design.md`.
- Depends on Phase 1 (teal accent), Phase 2 (`TerminalWindow`, reused by the new detail page), and Phase 3 (`ProjectAccent`, already present on `/projects` rows — untouched by this phase, just referenced for context).
- No demo GIF asset is recorded as part of this plan (content work, not code) — components and the detail page must render correctly with `demoGif` unset.
- `ProjectDemoGif` uses a plain `<img>`, not `next/image` (GIF-animation preservation) — this requires a `@next/next/no-img-element` eslint-disable, which must include the reason inline.
- Every new hover/transition effect is gated with Tailwind's `motion-reduce:` variant.
- `cd app && npm test` must pass after every task.

---

### Task 1: Extend the `Project` type with `demoGif`

**Files:**
- Modify: `app/content/projects.ts`

**Interfaces:**
- Produces: `Project.demoGif?: string` — consumed by Task 3 (`/projects/[slug]`).

No test file exists for this content module today (it's a typed data array, not logic) — this is a type-only addition, verified by the TypeScript compiler and by Task 3's tests exercising both the present and absent cases.

- [ ] **Step 1: Add the field**

Change `app/content/projects.ts` from:

```typescript
export type Project = {
  slug: string;
  name: string;
  description: string;
  href: string;
};

export const projects: Project[] = [
  {
    slug: "bgm-looper",
    name: "BGM Looper",
    description:
      "Upload a background-music track and get back a seamlessly looping, loudness-normalized version — beat-aligned loop point, equal-power crossfade, computed by a Python DSP pipeline on AWS Lambda.",
    href: "/tools/bgm-looper",
  },
];
```

to:

```typescript
export type Project = {
  slug: string;
  name: string;
  description: string;
  href: string;
  demoGif?: string;
};

export const projects: Project[] = [
  {
    slug: "bgm-looper",
    name: "BGM Looper",
    description:
      "Upload a background-music track and get back a seamlessly looping, loudness-normalized version — beat-aligned loop point, equal-power crossfade, computed by a Python DSP pipeline on AWS Lambda.",
    href: "/tools/bgm-looper",
  },
];
```

(`bgm-looper`'s entry stays without a `demoGif` — no recording exists yet. Add the path once one does; the detail page from Task 3 already handles both states.)

- [ ] **Step 2: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd app && git add content/projects.ts
git commit -m "$(cat <<'EOF'
feat: add optional demoGif field to the Project type

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 2: `ProjectDemoGif` component

**Files:**
- Create: `app/components/site/ProjectDemoGif.tsx`
- Test: `app/components/site/ProjectDemoGif.test.tsx`

**Interfaces:**
- Produces: `ProjectDemoGif({ src, alt, width, height, priority }: { src: string; alt: string; width: number; height: number; priority?: boolean })`. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

```tsx
// app/components/site/ProjectDemoGif.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectDemoGif } from "./ProjectDemoGif";

describe("ProjectDemoGif", () => {
  it("eager-loads when priority is true", () => {
    render(
      <ProjectDemoGif src="/demos/x.gif" alt="X demo" width={640} height={360} priority />,
    );
    const img = screen.getByRole("img", { name: "X demo" });
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("src", "/demos/x.gif");
    expect(img).toHaveAttribute("width", "640");
    expect(img).toHaveAttribute("height", "360");
  });

  it("lazy-loads by default", () => {
    render(<ProjectDemoGif src="/demos/y.gif" alt="Y demo" width={640} height={360} />);
    expect(screen.getByRole("img", { name: "Y demo" })).toHaveAttribute("loading", "lazy");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run components/site/ProjectDemoGif.test.tsx`
Expected: FAIL — `Cannot find module './ProjectDemoGif'`.

- [ ] **Step 3: Write the implementation**

```tsx
// app/components/site/ProjectDemoGif.tsx
type ProjectDemoGifProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
};

export function ProjectDemoGif({
  src,
  alt,
  width,
  height,
  priority = false,
}: ProjectDemoGifProps) {
  return (
    // next/image re-encodes images and can break GIF animation, so this
    // deliberately uses a plain <img> instead.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      className="w-full rounded-md border border-line"
    />
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run components/site/ProjectDemoGif.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd app && git add components/site/ProjectDemoGif.tsx components/site/ProjectDemoGif.test.tsx
git commit -m "$(cat <<'EOF'
feat: add priority-aware ProjectDemoGif component

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 3: `/projects/[slug]` detail page

**Files:**
- Create: `app/app/(site)/projects/[slug]/page.tsx`
- Test: `app/app/(site)/projects/[slug]/page.test.tsx`

**Interfaces:**
- Consumes: `projects` (Task 1), `TerminalWindow` (Phase 2), `ProjectDemoGif` (Task 2), `notFound` from `next/navigation`.
- Produces: default-exported async page component, `generateStaticParams()`. Consumed by Next's router (no other code imports this directly).

- [ ] **Step 1: Write the failing tests**

```tsx
// app/app/(site)/projects/[slug]/page.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectDetailPage from "./page";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("../../../../content/projects", () => ({
  projects: [
    {
      slug: "with-gif",
      name: "With Gif",
      description: "Has a demo.",
      href: "https://example.com/with-gif",
      demoGif: "/demos/with-gif.gif",
    },
    {
      slug: "no-gif",
      name: "No Gif",
      description: "Has no demo yet.",
      href: "https://example.com/no-gif",
    },
  ],
}));

describe("ProjectDetailPage", () => {
  it("renders the project name, description, and Open link for a known slug", async () => {
    const jsx = await ProjectDetailPage({
      params: Promise.resolve({ slug: "no-gif" }),
    });
    render(jsx);

    expect(screen.getByRole("heading", { name: "No Gif" })).toBeInTheDocument();
    expect(screen.getByText("Has no demo yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open →" })).toHaveAttribute(
      "href",
      "https://example.com/no-gif",
    );
  });

  it("renders the demo GIF when the project has one", async () => {
    const jsx = await ProjectDetailPage({
      params: Promise.resolve({ slug: "with-gif" }),
    });
    render(jsx);

    expect(screen.getByRole("img", { name: "With Gif demo" })).toHaveAttribute(
      "src",
      "/demos/with-gif.gif",
    );
  });

  it("omits the demo GIF section when the project has none", async () => {
    const jsx = await ProjectDetailPage({
      params: Promise.resolve({ slug: "no-gif" }),
    });
    render(jsx);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("calls notFound() for an unknown slug", async () => {
    await expect(
      ProjectDetailPage({ params: Promise.resolve({ slug: "does-not-exist" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run "app/(site)/projects/[slug]/page.test.tsx"`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 3: Write the implementation**

```tsx
// app/app/(site)/projects/[slug]/page.tsx
import { notFound } from "next/navigation";
import { projects } from "../../../../content/projects";
import { TerminalWindow } from "../../../../components/site/TerminalWindow";
import { ProjectDemoGif } from "../../../../components/site/ProjectDemoGif";

export function generateStaticParams() {
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
    <section>
      <TerminalWindow title={`cat ${project.slug}.md`}>
        <h1 className="text-lg font-semibold text-[var(--color-terminal-fg)]">
          {project.name}
        </h1>
        <p className="mt-3 leading-relaxed text-[var(--color-terminal-fg)]/80">
          {project.description}
        </p>
        {project.demoGif && (
          <div className="mt-6">
            <ProjectDemoGif
              src={project.demoGif}
              alt={`${project.name} demo`}
              width={640}
              height={360}
              priority
            />
          </div>
        )}
        <a
          href={project.href}
          className="mt-6 inline-block bg-[var(--color-accent)] px-3 py-2 font-semibold text-[var(--color-terminal-bg)] transition-opacity hover:opacity-85"
        >
          Open →
        </a>
      </TerminalWindow>
    </section>
  );
}
```

`priority` is passed unconditionally here because the demo GIF, when present, is the first substantial content after the page's `<h1>` — likely the page's LCP element (per spec §4, this is the deliberate exception to lazy-loading, not a default).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run "app/(site)/projects/[slug]/page.test.tsx"`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd app && git add "app/(site)/projects/[slug]/page.tsx" "app/(site)/projects/[slug]/page.test.tsx"
git commit -m "$(cat <<'EOF'
feat: add /projects/[slug] detail page with demo GIF slot

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 4: Point `/projects` rows at the detail page, add the hover chevron

**Files:**
- Modify: `app/app/(site)/projects/page.tsx` (as it stands after Phase 3's plan)
- Modify: `app/app/(site)/projects/page.test.tsx`

**Interfaces:**
- Consumes: nothing new — same `projects`/`TerminalWindow`/`ProjectAccent` imports as before, just a changed `href` and added markup.

- [ ] **Step 1: Update the test first**

In `app/app/(site)/projects/page.test.tsx`, change the first `it` block's expected `href` from `/tools/bgm-looper` to `/projects/bgm-looper` (the list now links to the detail page, not straight to the tool — the tool link lives on the detail page itself, per Task 3). The full file should read:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectsPage from "./page";

vi.mock("../../../components/site/hero/ProjectAccent", () => ({
  ProjectAccent: () => null,
}));

describe("ProjectsPage", () => {
  it("lists the BGM Looper project linking to its detail page", () => {
    render(<ProjectsPage />);
    expect(screen.getByRole("link", { name: "BGM Looper" })).toHaveAttribute(
      "href",
      "/projects/bgm-looper",
    );
  });

  it("renders inside the terminal window chrome", () => {
    render(<ProjectsPage />);
    expect(screen.getByText("projects — zsh")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run "app/(site)/projects/page.test.tsx"`
Expected: FAIL — the link still points at `/tools/bgm-looper`.

- [ ] **Step 3: Update the page**

In `app/app/(site)/projects/page.tsx`, change the `<li>` body from (Phase 3's version):

```tsx
              <li key={project.slug} className="flex items-start gap-4">
                <ProjectAccent />
                <div className="min-w-0 flex-1">
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
                </div>
              </li>
```

to:

```tsx
              <li key={project.slug} className="flex items-start gap-4">
                <ProjectAccent />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span aria-hidden="true" className="text-[var(--color-accent)]">
                      $
                    </span>
                    <Link
                      href={`/projects/${project.slug}`}
                      className="group/row inline-flex items-center gap-1.5 text-base font-semibold text-[var(--color-terminal-fg)] transition-colors hover:text-[var(--color-accent)]"
                    >
                      {project.name}
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 16 16"
                        className="h-3 w-3 shrink-0 -translate-x-1 opacity-0 transition-all duration-150 ease-out group-hover/row:translate-x-0 group-hover/row:opacity-100 motion-reduce:transition-none"
                      >
                        <path
                          d="M5 3l5 5-5 5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </Link>
                  </div>
                  <p className="mt-1 pl-4 text-[0.8125rem] leading-relaxed text-[var(--color-terminal-fg)]/70">
                    {project.description}
                  </p>
                </div>
              </li>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run "app/(site)/projects/page.test.tsx"`
Expected: PASS (2 tests) — the chevron `<svg>` is `aria-hidden`, so it doesn't affect the link's accessible name (`"BGM Looper"`).

- [ ] **Step 5: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd app && git add "app/(site)/projects/page.tsx" "app/(site)/projects/page.test.tsx"
git commit -m "$(cat <<'EOF'
feat: link /projects rows to their detail page, add hover chevron

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 5: Nav-link SVG underline

**Files:**
- Modify: `app/components/site/SiteHeader.tsx:28-37`

**Interfaces:** none new — purely visual, no props/exports change. `SiteHeader.test.tsx`'s existing link-role/name/href assertions are unaffected (the added `<svg>` is `aria-hidden`), so no test changes are needed for this task — verified by re-running the existing suite.

- [ ] **Step 1: Replace the nav-link markup**

In `app/components/site/SiteHeader.tsx`, change:

```tsx
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em]">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="border-b border-transparent pb-0.5 text-muted transition-colors hover:border-accent hover:text-fg"
            >
              {link.label}
            </Link>
          ))}
```

to:

```tsx
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em]">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group relative inline-block pb-1 text-muted transition-colors hover:text-fg"
            >
              {link.label}
              <svg
                aria-hidden="true"
                viewBox="0 0 100 4"
                preserveAspectRatio="none"
                className="absolute inset-x-0 -bottom-0.5 h-1 w-full"
              >
                <path
                  d="M0 2 H100"
                  stroke="var(--color-accent)"
                  strokeWidth="2"
                  pathLength="100"
                  className="[stroke-dasharray:100] [stroke-dashoffset:100] transition-[stroke-dashoffset] duration-200 ease-out group-hover:[stroke-dashoffset:0] motion-reduce:transition-none"
                />
              </svg>
            </Link>
          ))}
```

(The `pathLength="100"` attribute lets the dash values above be simple round numbers regardless of the path's actual on-screen length.)

- [ ] **Step 2: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS — `SiteHeader.test.tsx`'s link assertions still pass unmodified.

- [ ] **Step 3: Commit**

```bash
cd app && git add components/site/SiteHeader.tsx
git commit -m "$(cat <<'EOF'
feat: replace nav-link hover border with an SVG underline draw

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 6: Theme-toggle icon morph

**Files:**
- Modify: `app/components/site/ThemeToggle.tsx`
- Modify: `app/components/site/ThemeToggle.test.tsx`

**Interfaces:** none new — same `ThemeToggle()` no-props signature.

- [ ] **Step 1: Add a test for the accessible name**

Append this `it` block to the existing `describe("ThemeToggle", …)` in `app/components/site/ThemeToggle.test.tsx` (the two existing `it` blocks keep passing unmodified — `getByRole("button")` with no name filter matches regardless of the button's accessible name):

```tsx
  it("labels the button with the mode a click will switch to", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify the new assertion fails**

Run: `cd app && npx vitest run components/site/ThemeToggle.test.tsx`
Expected: FAIL — no `aria-label` exists yet, so `getByRole("button", { name: "Switch to light mode" })` finds nothing. The two pre-existing tests still pass.

- [ ] **Step 3: Add the icon and `aria-label`**

Replace the full contents of `app/components/site/ThemeToggle.tsx` with:

```tsx
// app/components/site/ThemeToggle.tsx
"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex items-center gap-1.5 border border-line px-2.5 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted transition-colors hover:border-accent hover:text-fg"
    >
      <span aria-hidden="true" className="relative inline-block h-3 w-3">
        <svg
          viewBox="0 0 24 24"
          className={`absolute inset-0 h-3 w-3 transition-all duration-200 motion-reduce:transition-none ${
            isDark ? "rotate-0 opacity-100" : "-rotate-90 opacity-0"
          }`}
        >
          <path
            d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M6.99 17.01l-1.4 1.4m12.8 0-1.4-1.4M6.99 6.99l-1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <svg
          viewBox="0 0 24 24"
          className={`absolute inset-0 h-3 w-3 transition-all duration-200 motion-reduce:transition-none ${
            isDark ? "rotate-90 opacity-0" : "rotate-0 opacity-100"
          }`}
        >
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" fill="currentColor" />
        </svg>
      </span>
      {isDark ? "Light mode" : "Dark mode"}
    </button>
  );
}
```

The sun icon (shown when `isDark`) and moon icon (shown otherwise) both represent the mode a click switches *to* — matching the existing text label's meaning, not the current mode.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run components/site/ThemeToggle.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd app && git add components/site/ThemeToggle.tsx components/site/ThemeToggle.test.tsx
git commit -m "$(cat <<'EOF'
feat: add morphing sun/moon icon to the theme toggle

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 7: Manual verification (motion & GIFs)

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev`

- [ ] **Step 2: Detail page and link target**

Open `/projects`, confirm each row still links correctly, click into `/projects/bgm-looper`, confirm it renders inside terminal chrome with the description and an "Open →" button pointing at `/tools/bgm-looper`. Since no demo GIF exists yet, confirm the page looks correct without one (no broken-image icon, no empty gap).

- [ ] **Step 3: Micro-interactions, both themes**

In both light and dark theme: hover each header nav link and confirm the underline draws in smoothly; hover a `/projects` row and confirm the chevron slides in next to the project name; click the theme toggle a few times and confirm the sun/moon icon morphs.

- [ ] **Step 4: Reduced motion**

Enable "reduce motion" (OS setting, or Chrome DevTools Rendering tab → "Emulate CSS media feature prefers-reduced-motion: reduce"). Repeat Step 3's three interactions — confirm each still changes state correctly (link still navigates, chevron still becomes visible/link still works, toggle still switches theme) but without an animated transition.

- [ ] **Step 5: Stop the dev server**

Ctrl+C in the terminal running `npm run dev`.

No commit for this task.

---

### Task 8: Final cross-cutting perf & a11y pass (former "Phase 5")

This is a validation pass across all four phases together, not new functionality — folded into this plan rather than given its own design spec, per the brainstorming decision recorded in this plan's originating conversation.

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Start the dev server (or use a production build)**

Run: `cd app && npm run build && npm run start`
(A production build gives a more representative Lighthouse/LCP read than `next dev`.)

- [ ] **Step 2: Lighthouse pass with the 3D scene live**

Run a Lighthouse audit (Chrome DevTools → Lighthouse tab, or `npx lighthouse http://localhost:3000 --view`) against `/` (which renders `HeroScene`) at both a desktop and a mobile device preset. Note the LCP element and value at each. If LCP regresses noticeably against a pre-overhaul baseline, investigate whether the 3D scene's dynamic-import chunk is delaying it (it shouldn't, per Phase 3 Task 8's design, but this is the check that confirms it).

- [ ] **Step 3: Full keyboard-only run-through of the command bar**

Starting from a page with no prior focus (fresh tab), using only the keyboard: `Tab` to the `⌘K` trigger, open it, type a partial command, arrow through results, `Enter` to navigate. Then repeat and close with `Escape` instead, confirming focus visibly returns to the trigger. Confirm `Tab`/`Shift+Tab` never escapes the dialog while it's open.

- [ ] **Step 4: Screen-reader spot check**

Using a screen reader (VoiceOver on macOS, Narrator on Windows, or a browser extension), navigate the home page hero, the `/projects` listing, a `/projects/[slug]` detail page, and the command bar. Confirm: the `⌘K` button announces "Open command bar"; the command-bar dialog announces itself as a dialog when opened; the 3D hero and per-project accents are silent (they're decorative — confirm nothing inside `HeroScene`/`ProjectAccent`/`SceneFallback` is being announced, since none of those components render any text content or ARIA labels); the theme toggle announces the mode it will switch to.

- [ ] **Step 5: Record findings**

If Steps 2-4 surface a real regression (not a pre-existing condition unrelated to this overhaul), fix it in the relevant phase's files and re-run that phase's test suite before considering the overhaul complete. If nothing is found, no further action — this task has no commit of its own since it produces no file changes when everything passes.

---

## Self-Review Notes

- **Spec coverage:** §3 (detail page, `demoGif` field) → Tasks 1, 3. §4 (`ProjectDemoGif`, priority-driven `loading`) → Task 2. §5 (three SVG micro-interactions, each `motion-reduce`-gated) → Tasks 4-6. §6 (testing boundaries: GIF component tested, hover-only SVG visuals verified manually) → Tasks 2-6 automated portions plus Task 7. The folded-in perf/a11y pass → Task 8.
- **Type consistency:** `Project.demoGif?: string` (Task 1) matches its usage in Task 3's `project.demoGif` check and `ProjectDemoGif`'s `src` prop type (Task 2) exactly.
- **No placeholders:** every code block is complete; the `ProjectDemoGif` eslint-disable includes its reason inline rather than being a bare suppression.
