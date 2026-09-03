# Portfolio Site Shell (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn bgm-looper into a personal portfolio site: public home/about/projects/resume/contact pages, with the BGM Looper demoted to a single gated tool at `/tools/bgm-looper`.

**Architecture:** Single Next.js app (no new repo, no new AWS resources). A new `(site)` route group holds the public pages under a shared header/footer layout; the existing looper page/login/API routes move under `/tools/bgm-looper` and `/api/looper/*`. Auth gating is rewritten as a pure, unit-tested `isGatedPath()` function so only those two prefixes require the session cookie — everything else is served with no auth check at all.

**Tech Stack:** Next.js 15 / React 19 (existing), Tailwind CSS v4 (new — chosen over plain CSS Modules for faster visual iteration), Vitest + Testing Library (existing).

## Global Constraints

- Total AWS spend must stay under 200 INR/month. This plan adds **zero new AWS resources** — do not add any AWS SDK calls, new Terraform resources, or new env vars reading AWS config as part of this plan.
- No self-hosted CMS or server anywhere in this project (evaluated and rejected in the spec on cost grounds).
- Dark theme is the default; a light-mode toggle must be present and persisted (localStorage).
- Styling is Tailwind CSS v4 utility classes — no CSS Modules, no styled-components.
- No MDX, no blog, no newsletter, no custom domain, no contact form — all explicitly out of scope for this phase (separate future specs).
- Any `aws` CLI command run manually during this work must use `--profile personal` (see `CLAUDE.md` gotchas) — not relevant to the code in this plan, but relevant if verifying anything against the live AWS account.
- Follow existing repo conventions: relative imports for anything covered by a Vitest test (the `@/*` path alias only resolves in the Next.js build, not in `vitest.config.ts`, so keep new tested modules on relative imports to avoid adding alias-resolution config).

---

### Task 1: Tailwind CSS setup + dark/light theme tokens

**Files:**
- Create: `app/postcss.config.mjs`
- Create: `app/app/globals.css`
- Modify: `app/package.json` (new devDependencies)
- Modify: `app/app/layout.tsx`

**Interfaces:**
- Produces: Tailwind utility classes (`bg-bg`, `text-fg`, `bg-accent`, `text-accent`, `font-mono`, and standard Tailwind utilities) available to every component created in later tasks. Produces the `.dark` class contract: when present on `<html>`, dark theme tokens apply; when absent, light theme tokens apply. Root layout defaults `<html>` to `className="dark"`.

- [x] **Step 1: Install Tailwind CSS v4**

```bash
cd app && npm install -D tailwindcss @tailwindcss/postcss postcss
```

- [x] **Step 2: Create the PostCSS config**

Create `app/postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [x] **Step 3: Create the global stylesheet with theme tokens**

Create `app/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-bg: #ffffff;
  --color-fg: #111111;
  --color-accent: #0891b2;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", monospace;
}

:root.dark {
  --color-bg: #0a0a0a;
  --color-fg: #e5e5e5;
  --color-accent: #22d3ee;
}

html {
  background-color: var(--color-bg);
  color-scheme: light dark;
}

html.dark {
  color-scheme: dark;
}
```

- [x] **Step 4: Wire the stylesheet and default theme into the root layout**

Replace the contents of `app/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ashutosh Pandey",
  description: "Portfolio — projects, resume, and the BGM Looper tool.",
};

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var theme = stored === "light" || stored === "dark" ? stored : "dark";
    document.documentElement.classList.toggle("dark", theme === "dark");
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg font-mono text-fg">{children}</body>
    </html>
  );
}
```

- [x] **Step 5: Verify the app still builds and lints**

Run: `cd app && npm run lint && npm run build`
Expected: both succeed with no errors (Tailwind's PostCSS plugin picks up `globals.css` automatically via the Next.js build).

- [x] **Step 6: Commit**

```bash
git add app/postcss.config.mjs app/app/globals.css app/app/layout.tsx app/package.json app/package-lock.json
git commit -m "feat: add Tailwind CSS v4 with dark-default theme tokens"
```

---

### Task 2: Route-gating logic + middleware rewrite

**Files:**
- Create: `app/lib/route-gate.ts`
- Create: `app/lib/route-gate.test.ts`
- Modify: `app/middleware.ts`

**Interfaces:**
- Consumes: nothing new (uses existing `COOKIE_NAME`, `verifySessionCookieValue` from `app/lib/auth.ts`, unchanged).
- Produces: `isGatedPath(pathname: string): boolean` — Task 4's nav and Task 3's moved login page rely on `/tools/bgm-looper` and `/tools/bgm-looper/login` being the exact strings this function checks against.

- [x] **Step 1: Write the failing test**

Create `app/lib/route-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isGatedPath } from "./route-gate";

describe("isGatedPath", () => {
  it.each([
    ["/", false],
    ["/about", false],
    ["/projects", false],
    ["/resume", false],
    ["/contact", false],
    ["/keystatic", false],
    ["/tools/bgm-looper", true],
    ["/tools/bgm-looper/", true],
    ["/tools/bgm-looper/login", false],
    ["/api/login", false],
    ["/api/looper/process", true],
    ["/api/looper/upload-url", true],
  ])("isGatedPath(%s) === %s", (pathname, expected) => {
    expect(isGatedPath(pathname)).toBe(expected);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run lib/route-gate.test.ts`
Expected: FAIL — `Cannot find module './route-gate'`

- [x] **Step 3: Implement `isGatedPath`**

Create `app/lib/route-gate.ts`:

```ts
const GATED_PREFIXES = ["/tools/bgm-looper", "/api/looper"];
const ALWAYS_ALLOWED_PATHS = ["/tools/bgm-looper/login", "/api/login"];

export function isGatedPath(pathname: string): boolean {
  if (ALWAYS_ALLOWED_PATHS.includes(pathname)) {
    return false;
  }
  return GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run lib/route-gate.test.ts`
Expected: PASS — all 12 cases green.

- [x] **Step 5: Rewrite the middleware to use it**

Replace the contents of `app/middleware.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionCookieValue } from "./lib/auth";
import { isGatedPath } from "./lib/route-gate";

export const runtime = "nodejs";

export function middleware(request: NextRequest) {
  if (!isGatedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  const secret = process.env.COOKIE_SECRET!;

  if (!verifySessionCookieValue(cookie, secret)) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/tools/bgm-looper/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

The matcher stays broad on purpose — middleware still runs on every request, but `isGatedPath` makes it a no-op for public paths. This is simpler and safer than trying to encode two allow/deny prefixes directly in Next's matcher regex syntax.

- [x] **Step 6: Run the full test suite to confirm nothing else broke**

Run: `cd app && npm test`
Expected: PASS (existing `auth.test.ts`, `aws.test.ts`, `page.test.tsx` all still pass — none of them exercise the middleware directly).

- [x] **Step 7: Commit**

```bash
git add app/lib/route-gate.ts app/lib/route-gate.test.ts app/middleware.ts
git commit -m "feat: gate only /tools/bgm-looper and /api/looper, not the whole site"
```

---

### Task 3: Move the BGM Looper tool under /tools/bgm-looper

**Files:**
- Move: `app/app/page.tsx` → `app/app/tools/bgm-looper/page.tsx`
- Move: `app/app/page.test.tsx` → `app/app/tools/bgm-looper/page.test.tsx`
- Move: `app/app/login/page.tsx` → `app/app/tools/bgm-looper/login/page.tsx`
- Move: `app/app/api/process/route.ts` → `app/app/api/looper/process/route.ts`
- Move: `app/app/api/upload-url/route.ts` → `app/app/api/looper/upload-url/route.ts`
- Modify: the moved `page.tsx` and `login/page.tsx` (URLs/redirect target only)

**Interfaces:**
- Consumes: Task 2's `isGatedPath` already expects `/tools/bgm-looper`, `/api/looper/process`, `/api/looper/upload-url`, `/tools/bgm-looper/login` to exist as real routes — this task makes them real.
- Produces: `/tools/bgm-looper` as the stable URL later tasks (Task 4's nav CTA, Task 7's project card) link to.

- [x] **Step 1: Move the files, preserving git history**

```bash
cd app
mkdir -p app/tools/bgm-looper/login app/api/looper
git mv app/page.tsx app/tools/bgm-looper/page.tsx
git mv app/page.test.tsx app/tools/bgm-looper/page.test.tsx
git mv app/login/page.tsx app/tools/bgm-looper/login/page.tsx
git mv app/api/process/route.ts app/api/looper/process/route.ts
git mv app/api/upload-url/route.ts app/api/looper/upload-url/route.ts
```

- [x] **Step 2: Update the moved tool page's fetch URLs**

In `app/app/tools/bgm-looper/page.tsx`, change:

```ts
const urlRes = await fetch("/api/upload-url", {
```
to:
```ts
const urlRes = await fetch("/api/looper/upload-url", {
```

and change:

```ts
const processRes = await fetch("/api/process", {
```
to:
```ts
const processRes = await fetch("/api/looper/process", {
```

- [x] **Step 3: Update the moved login page's redirect target**

In `app/app/tools/bgm-looper/login/page.tsx`, change:

```ts
router.push("/");
```
to:
```ts
router.push("/tools/bgm-looper");
```

- [x] **Step 4: Run the full test suite to verify the move didn't break anything**

Run: `cd app && npm test`
Expected: PASS — `tools/bgm-looper/page.test.tsx` still passes unchanged (it mocks `fetch` generically without asserting on the URL argument, so the endpoint rename doesn't affect it).

- [x] **Step 5: Run lint and build**

Run: `cd app && npm run lint && npm run build`
Expected: both succeed — confirms Next.js resolves the new route tree correctly.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move BGM Looper tool to /tools/bgm-looper, APIs to /api/looper/*"
```

---

### Task 4: Shared site header, footer, and theme toggle

**Files:**
- Create: `app/components/site/ThemeToggle.tsx`
- Create: `app/components/site/ThemeToggle.test.tsx`
- Create: `app/components/site/SiteHeader.tsx`
- Create: `app/components/site/SiteHeader.test.tsx`
- Create: `app/components/site/SiteFooter.tsx`
- Create: `app/app/(site)/layout.tsx`

**Interfaces:**
- Consumes: Task 3's `/tools/bgm-looper` as the CTA link target.
- Produces: `SiteLayout` wrapping component, reused by every page created in Tasks 5–9 (they live inside the `(site)` route group and automatically get this layout — no per-page import needed).

- [x] **Step 1: Write the failing ThemeToggle test**

Create `app/components/site/ThemeToggle.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.classList.add("dark");
    localStorage.clear();
  });

  it("switches from dark to light and persists the choice", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("switches back from light to dark", () => {
    document.documentElement.classList.remove("dark");
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run components/site/ThemeToggle.test.tsx`
Expected: FAIL — `Cannot find module './ThemeToggle'`

- [x] **Step 3: Implement ThemeToggle**

Create `app/components/site/ThemeToggle.tsx`:

```tsx
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
      aria-label="Toggle color theme"
      className="rounded border border-fg/20 px-2 py-1 text-sm hover:border-accent"
    >
      {isDark ? "Light mode" : "Dark mode"}
    </button>
  );
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run components/site/ThemeToggle.test.tsx`
Expected: PASS

- [x] **Step 5: Write the failing SiteHeader test**

Create `app/components/site/SiteHeader.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "./SiteHeader";

describe("SiteHeader", () => {
  it("renders nav links and the BGM Looper CTA", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: "Resume" })).toHaveAttribute("href", "/resume");
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
    expect(screen.getByRole("link", { name: "BGM Looper" })).toHaveAttribute(
      "href",
      "/tools/bgm-looper",
    );
  });
});
```

- [x] **Step 6: Run it to verify it fails**

Run: `cd app && npx vitest run components/site/SiteHeader.test.tsx`
Expected: FAIL — `Cannot find module './SiteHeader'`

- [x] **Step 7: Implement SiteHeader**

Create `app/components/site/SiteHeader.tsx`:

```tsx
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/projects", label: "Projects" },
  { href: "/resume", label: "Resume" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between border-b border-fg/10 px-6 py-4">
      <Link href="/" className="font-bold">
        Ashutosh Pandey
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="hover:text-accent">
            {link.label}
          </Link>
        ))}
        <Link
          href="/tools/bgm-looper"
          className="rounded bg-accent px-3 py-1 text-bg hover:opacity-90"
        >
          BGM Looper
        </Link>
        <ThemeToggle />
      </nav>
    </header>
  );
}
```

- [x] **Step 8: Run it to verify it passes**

Run: `cd app && npx vitest run components/site/SiteHeader.test.tsx`
Expected: PASS

- [x] **Step 9: Implement SiteFooter (no test — static markup, nothing to assert beyond what SiteHeader-style tests already cover the pattern for)**

Create `app/components/site/SiteFooter.tsx`:

```tsx
export function SiteFooter() {
  return (
    <footer className="border-t border-fg/10 px-6 py-4 text-sm text-fg/60">
      © {new Date().getFullYear()} Ashutosh Pandey
    </footer>
  );
}
```

- [x] **Step 10: Assemble the (site) route group layout**

Create `app/app/(site)/layout.tsx`:

```tsx
import { SiteHeader } from "../../components/site/SiteHeader";
import { SiteFooter } from "../../components/site/SiteFooter";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1 px-6 py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}
```

- [x] **Step 11: Run the full suite**

Run: `cd app && npm test`
Expected: PASS (new tests green, nothing else affected — `(site)/layout.tsx` has no page routing into it yet until Task 5).

- [x] **Step 12: Commit**

```bash
git add app/components/site app/app/\(site\)/layout.tsx
git commit -m "feat: add site header, footer, and dark/light theme toggle"
```

---

### Task 5: Home page

**Files:**
- Create: `app/app/(site)/page.tsx`
- Create: `app/app/(site)/page.test.tsx`

**Interfaces:**
- Consumes: Task 4's `SiteLayout` (applied automatically via the route group — this file does not import it).

- [x] **Step 1: Write the failing test**

Create `app/app/(site)/page.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the name as the main heading", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Ashutosh Pandey" })).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run "app/(site)/page.test.tsx"`
Expected: FAIL — `Cannot find module './page'`

- [x] **Step 3: Implement the home page**

Create `app/app/(site)/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold">Ashutosh Pandey</h1>
      <p className="mt-4 text-fg/80">
        Software engineer. I build small, focused tools — like the BGM
        Looper, a DSP pipeline that turns a music file into a seamless loop.
      </p>
    </section>
  );
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run "app/(site)/page.test.tsx"`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add "app/app/(site)/page.tsx" "app/app/(site)/page.test.tsx"
git commit -m "feat: add portfolio home page"
```

---

### Task 6: About page

**Files:**
- Create: `app/app/(site)/about/page.tsx`
- Create: `app/app/(site)/about/page.test.tsx`

- [x] **Step 1: Write the failing test**

Create `app/app/(site)/about/page.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AboutPage from "./page";

describe("AboutPage", () => {
  it("renders an About heading", () => {
    render(<AboutPage />);
    expect(screen.getByRole("heading", { level: 1, name: "About" })).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run "app/(site)/about/page.test.tsx"`
Expected: FAIL — `Cannot find module './page'`

- [x] **Step 3: Implement the about page**

Create `app/app/(site)/about/page.tsx`:

```tsx
export default function AboutPage() {
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">About</h1>
      <p className="mt-4 text-fg/80">
        Replace this paragraph with your real background, skills, and
        interests.
      </p>
    </section>
  );
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run "app/(site)/about/page.test.tsx"`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add "app/app/(site)/about"
git commit -m "feat: add portfolio about page"
```

---

### Task 7: Projects page

**Files:**
- Create: `app/content/projects.ts`
- Create: `app/app/(site)/projects/page.tsx`
- Create: `app/app/(site)/projects/page.test.tsx`

**Interfaces:**
- Produces: `Project` type and `projects` array — the shape any project added in a future phase must match (`slug`, `name`, `description`, `href`).

- [x] **Step 1: Write the failing test**

Create `app/app/(site)/projects/page.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectsPage from "./page";

describe("ProjectsPage", () => {
  it("lists the BGM Looper project linking to the tool", () => {
    render(<ProjectsPage />);
    expect(screen.getByRole("link", { name: "BGM Looper" })).toHaveAttribute(
      "href",
      "/tools/bgm-looper",
    );
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run "app/(site)/projects/page.test.tsx"`
Expected: FAIL — `Cannot find module './page'`

- [x] **Step 3: Create the project content data**

Create `app/content/projects.ts`:

```ts
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

- [x] **Step 4: Implement the projects page**

Create `app/app/(site)/projects/page.tsx`:

```tsx
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
```

- [x] **Step 5: Run it to verify it passes**

Run: `cd app && npx vitest run "app/(site)/projects/page.test.tsx"`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add app/content/projects.ts "app/app/(site)/projects"
git commit -m "feat: add portfolio projects page"
```

---

### Task 8: Resume page

**Files:**
- Create: `app/content/resume.ts`
- Create: `app/app/(site)/resume/page.tsx`
- Create: `app/app/(site)/resume/page.test.tsx`

**Interfaces:**
- Produces: `ResumeEntry` type and `resume` array — shape any future entry must match (`role`, `org`, `start`, `end`, `bullets`).

- [x] **Step 1: Write the failing test**

Create `app/app/(site)/resume/page.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ResumePage from "./page";
import { resume } from "../../../content/resume";

describe("ResumePage", () => {
  it("renders a timeline entry for every resume item and a PDF download link", () => {
    render(<ResumePage />);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(resume.length);
    expect(screen.getByRole("link", { name: /download pdf/i })).toHaveAttribute(
      "href",
      "/resume.pdf",
    );
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run "app/(site)/resume/page.test.tsx"`
Expected: FAIL — `Cannot find module './page'`

- [x] **Step 3: Create the resume content data**

Create `app/content/resume.ts`:

```ts
export type ResumeEntry = {
  role: string;
  org: string;
  start: string;
  end: string;
  bullets: string[];
};

export const resume: ResumeEntry[] = [
  {
    role: "Add your most recent role here",
    org: "Add your employer here",
    start: "20XX",
    end: "Present",
    bullets: [
      "Replace with a real accomplishment, focused on impact and scale.",
      "Add 2-4 bullets per role.",
    ],
  },
];
```

- [x] **Step 4: Implement the resume page**

Create `app/app/(site)/resume/page.tsx`:

```tsx
import { resume } from "../../../content/resume";

export default function ResumePage() {
  return (
    <section className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Resume</h1>
        <a
          href="/resume.pdf"
          download
          className="rounded bg-accent px-3 py-1 text-bg hover:opacity-90"
        >
          Download PDF
        </a>
      </div>
      <ol className="mt-6 flex flex-col gap-6 border-l border-fg/10 pl-4">
        {resume.map((entry) => (
          <li key={`${entry.org}-${entry.start}`}>
            <p className="font-semibold">
              {entry.role} · {entry.org}
            </p>
            <p className="text-sm text-fg/60">
              {entry.start} – {entry.end}
            </p>
            <ul className="mt-2 list-disc pl-5 text-fg/80">
              {entry.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [x] **Step 5: Run it to verify it passes**

Run: `cd app && npx vitest run "app/(site)/resume/page.test.tsx"`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add app/content/resume.ts "app/app/(site)/resume"
git commit -m "feat: add portfolio resume page"
```

**Manual follow-up (not automatable — flag to the user, don't skip):** `content/resume.ts` ships with sample placeholder text, and `/resume.pdf` doesn't exist yet. The user must (1) edit `app/content/resume.ts` with real work history, and (2) add a real `app/public/resume.pdf` file. Until both are done, the page renders sample content and the download link 404s.

---

### Task 9: Contact page

**Files:**
- Create: `app/app/(site)/contact/page.tsx`
- Create: `app/app/(site)/contact/page.test.tsx`

- [x] **Step 1: Write the failing test**

Create `app/app/(site)/contact/page.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ContactPage from "./page";

describe("ContactPage", () => {
  it("renders a mailto link with the real email", () => {
    render(<ContactPage />);
    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute(
      "href",
      "mailto:ashutosh.pandeyhlr007@gmail.com",
    );
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run "app/(site)/contact/page.test.tsx"`
Expected: FAIL — `Cannot find module './page'`

- [x] **Step 3: Implement the contact page**

Create `app/app/(site)/contact/page.tsx`:

```tsx
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
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run "app/(site)/contact/page.test.tsx"`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add "app/app/(site)/contact"
git commit -m "feat: add portfolio contact page"
```

**Manual follow-up (not automatable):** the GitHub and LinkedIn URLs in `CONTACT_LINKS` are placeholders (`your-username`) — the implementer must not guess the user's real profile URLs; the user should fill these in themselves.

---

### Task 10: Visual design pass (frontend-design skill)

**Files:** likely touches `app/app/globals.css`, `app/components/site/*.tsx`, and all `(site)` page files created in Tasks 5–9 — exact files depend on what the skill recommends.

**Interfaces:**
- Consumes: every component and page from Tasks 1–9 as its starting point (functional but visually minimal utility-class markup).
- Produces: no new interfaces — this task only restyles existing components/pages, it must not change any component's props, exported names, or the `Project`/`ResumeEntry` data shapes, since Tasks 5–9's tests assert against those.

- [x] **Step 1: Invoke the design skill**

Run the `frontend-design` skill (via the `Skill` tool) against the current state of the `(site)` route group and shared components, with the brief: dark-default technical aesthetic (monospace accents, audio/DSP-engineer feel), light-mode toggle already wired up in `ThemeToggle`/`globals.css` theme tokens. Follow its guidance for typography scale, spacing, and color-token refinement.

- [x] **Step 2: Apply the recommended changes**

Edit `globals.css` theme tokens and component/page class names per the skill's output. Do not rename exported component/type identifiers or change data shapes.

- [x] **Step 3: Re-run the full test suite after restyling**

Run: `cd app && npm test`
Expected: PASS — restyling only changes `className` strings and CSS, none of which the existing tests assert on (they assert roles, text, hrefs — not classes).

- [x] **Step 4: Run lint and build**

Run: `cd app && npm run lint && npm run build`
Expected: both succeed.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "style: apply frontend-design visual pass to portfolio pages"
```

---

### Task 11: Full-repo verification and manual browser QA

**Files:** none (verification only)

- [x] **Step 1: Run the full automated test suite**

Run: `cd app && npm test`
Expected: PASS — all tests across `lib/`, `components/site/`, `app/(site)/*`, and `app/tools/bgm-looper/*` green.

- [x] **Step 2: Run lint and build**

Run: `cd app && npm run lint && npm run build`
Expected: both succeed with no errors or warnings.

- [x] **Step 3: Start the dev server and manually verify in a browser**

Run: `cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev`

Manually check, per `CLAUDE.md`'s guidance to verify UI changes in a real browser:
- `/`, `/about`, `/projects`, `/resume`, `/contact` load with no login prompt (public, per Task 2's gating).
- `/tools/bgm-looper` redirects to `/tools/bgm-looper/login` when not authenticated.
- Logging in with `test123` at `/tools/bgm-looper/login` redirects to `/tools/bgm-looper` and the tool works as before.
- The theme toggle in the header switches between dark and light, and the choice survives a page reload.
- The "BGM Looper" nav link and the Projects-page project card both land on `/tools/bgm-looper`.

- [x] **Step 4: Commit any fixes found during manual QA, if needed**

If manual QA surfaces a bug, fix it, re-run the relevant automated test, then:

```bash
git add -A
git commit -m "fix: <describe the specific bug found during manual QA>"
```

If no bugs are found, no commit is needed for this task.
