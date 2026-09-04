# Portfolio Blog (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a blog to the portfolio site, editable via Keystatic (a git-backed CMS, GitHub-mode storage) at `/keystatic`, reusing the existing password gate.

**Architecture:** Keystatic's admin UI and API routes are added to the existing Next.js app. Blog posts are `.mdx` files at the *repo root* (`content/blog/`, sibling to `app/`, not inside it) — required because Keystatic's GitHub-mode writes are repo-root-relative while Vercel's `root_directory = "app"` makes the app's own `process.cwd()` be `app/`. A single `createReader()` wrapper resolves this by rooting the reader one directory above `process.cwd()`. Public `/blog` and `/blog/[slug]` pages are thin async Server Components that read via that wrapper and hand data to synchronous, unit-tested presentational components.

**Tech Stack:** `@keystatic/core`, `@keystatic/next`, `@markdoc/markdoc` (Keystatic's own dependency for its `mdx`/`markdoc` fields), `next-mdx-remote` (renders the stored MDX body — Keystatic stores content but deliberately leaves rendering to the consuming app).

Every code snippet, file path, and API call in this plan was verified against the actually-installed `@keystatic/core`/`@keystatic/next`/`next-mdx-remote` packages' real TypeScript declarations and, for the two riskiest points (content-path resolution, and whether GitHub-mode storage requires auth just to *read*), against a real, executed Node script — not assumed from documentation alone.

## Global Constraints

- Total AWS spend must stay under 200 INR/month. This plan touches no AWS resource at all — Keystatic's GitHub mode uses GitHub's API and this app's own Next.js routes on Vercel, both already in use.
- No self-hosted CMS/server/database anywhere in this project (already ruled out in the phase-2 spec on cost grounds) — Keystatic's GitHub mode satisfies this by committing files via GitHub's API, not by running its own backend.
- `/keystatic` and `/api/keystatic/*` reuse the existing shared-password cookie via `app/lib/route-gate.ts` — no new auth mechanism.
- Blog content lives at `<repo-root>/content/blog/*.mdx` — a *different, sibling* directory to Phase 1's `app/content/projects.ts`/`app/content/resume.ts`. This is required by how Keystatic's GitHub-mode API paths work (repo-root-relative) versus Vercel's `root_directory = "app"` (makes `process.cwd()` be `app/`), not an inconsistency to "fix."
- The Keystatic collection's `format` must include `{ contentField: 'content' }` — without it, the body is not written as the entry's markdown/MDX content.
- No `branchPrefix` is configured on the GitHub storage config — Keystatic commits straight to this repo's actual default branch (`dev`, per `CLAUDE.md`), matching how everything else in this repo works.
- `next-mdx-remote/rsc`'s `<MDXRemote>` is a React-Server-Component-only construct and cannot render under Vitest/jsdom/React Testing Library. It must only ever be imported inside the untested async `page.tsx` files — never inside a component that has its own test file.
- Relative imports (not the `@/*` alias) for anything covered by a Vitest test, per existing repo convention — the alias only resolves in the Next.js build, not in `vitest.config.ts`.
- `app/.gitignore` must cover plain `.env` (currently it only covers `.env*.local`) *before* the manual Keystatic GitHub App setup (a separate, human-only step outside this plan) generates real secrets into a `.env` file.

---

### Task 1: Fix `.env` gitignore gap

**Files:**
- Modify: `app/.gitignore`

**Interfaces:** none — this task has no code dependents, it's a prerequisite for the human's later manual setup step (not part of this plan) to be safe.

- [x] **Step 1: Confirm the gap**

Run: `cd app && cat .gitignore`
Expected output includes `node_modules/`, `.next/`, `.env*.local` — and does **not** include a bare `.env` entry. (`.env*.local` matches `.env.local`, `.env.production.local`, etc. — it does not match plain `.env`.)

- [x] **Step 2: Add the missing entry**

In `app/.gitignore`, add a new line: `.env`

- [x] **Step 3: Verify**

Run: `cd app && touch .env && git check-ignore -q .env && echo "ignored" || echo "NOT ignored"`
Expected: `ignored`

Run: `cd app && rm .env`

- [x] **Step 4: Commit**

```bash
git add app/.gitignore
git commit -m "chore: gitignore plain .env, not just .env*.local"
```

---

### Task 2: Keystatic config, repo-rooted reader, and a seed post

**Files:**
- Create: `app/keystatic.config.ts`
- Create: `app/lib/keystatic-reader.ts`
- Create: `app/lib/keystatic-reader.test.ts`
- Create: `content/blog/hello-world.mdx` (repo root — sibling to `app/`, **not** inside it)
- Modify: `app/package.json`, `app/package-lock.json` (new dependencies)

**Interfaces:**
- Produces: `getReader(): Reader` from `app/lib/keystatic-reader.ts` — every later task that reads blog content (Task 7) imports this, not `createReader` directly.
- Produces: the `blog` collection schema (`title: string`, `date: string | null`, `summary: string`, `tags: readonly string[]`, `content: () => Promise<string>`) — Tasks 6 and 7 depend on exactly these field names and shapes.

- [x] **Step 1: Install dependencies**

```bash
cd app && npm install @keystatic/core @keystatic/next @markdoc/markdoc next-mdx-remote
```

- [x] **Step 2: Create the Keystatic config**

Create `app/keystatic.config.ts`:

```ts
import { config, fields, collection } from "@keystatic/core";

export default config({
  storage: {
    kind: "github",
    repo: "DataCrusade1999/supreme-enigma",
  },
  collections: {
    blog: collection({
      label: "Blog",
      slugField: "title",
      path: "content/blog/*",
      format: { contentField: "content" },
      schema: {
        title: fields.slug({ name: { label: "Title" } }),
        date: fields.date({ label: "Date" }),
        summary: fields.text({ label: "Summary" }),
        tags: fields.array(fields.text({ label: "Tag" }), { label: "Tags" }),
        content: fields.mdx({ label: "Content" }),
      },
    }),
  },
});
```

- [x] **Step 3: Write the failing reader test**

Create `app/lib/keystatic-reader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getReader } from "./keystatic-reader";

describe("getReader", () => {
  it("resolves content/blog relative to the repo root (not app/) and finds the seed post", async () => {
    const reader = getReader();
    const slugs = await reader.collections.blog.list();
    expect(slugs).toContain("hello-world");

    const entry = await reader.collections.blog.readOrThrow("hello-world");
    expect(entry.title).toBe("Hello, World");
    expect(entry.summary).toContain("Keystatic");
    expect(entry.tags).toContain("meta");

    const body = await entry.content();
    expect(body).toContain("first post");
  });
});
```

- [x] **Step 4: Run it to verify it fails**

Run: `cd app && npx vitest run lib/keystatic-reader.test.ts`
Expected: FAIL — `Cannot find module './keystatic-reader'`

- [x] **Step 5: Implement the repo-rooted reader**

Create `app/lib/keystatic-reader.ts`:

```ts
import path from "node:path";
import { createReader } from "@keystatic/core/reader";
import config from "../keystatic.config";

export function getReader() {
  return createReader(path.join(process.cwd(), ".."), config);
}
```

This resolves one directory above `process.cwd()` — `app/` locally (`npm run dev`/`npm test` both run from `app/`) and on Vercel (`root_directory = "app"`) — landing on the repo root, matching where Keystatic's GitHub-mode API writes (`content/blog/*`, always repo-root-relative regardless of Vercel's root-directory setting).

- [x] **Step 6: Create the seed post**

Create `content/blog/hello-world.mdx` **at the repo root** (i.e. `E:\Personal\looper\content\blog\hello-world.mdx` if you're in the main checkout, or `<worktree-root>/content/blog/hello-world.mdx` — a sibling to this branch's `app/` directory, not inside it):

```mdx
---
title: Hello, World
date: 2026-08-01
summary: This blog is powered by Keystatic — edit or delete this post any time from /keystatic.
tags:
  - meta
---

This is the first post on this blog. It's written in MDX and stored as a
plain file in this repo, committed through
[Keystatic](https://keystatic.com)'s admin UI at `/keystatic`.
```

This is real, shipped seed content (not a hidden test fixture) — it both proves the read pipeline works end-to-end and gives the blog a non-empty starting point. The frontmatter above is Keystatic's own file format for this collection (YAML frontmatter + MDX body, per `format: { contentField: 'content' }`).

- [x] **Step 7: Run it to verify it passes**

Run: `cd app && npx vitest run lib/keystatic-reader.test.ts`
Expected: PASS

- [x] **Step 8: Commit**

```bash
git add app/keystatic.config.ts app/lib/keystatic-reader.ts app/lib/keystatic-reader.test.ts app/package.json app/package-lock.json content/blog/hello-world.mdx
git commit -m "feat: add Keystatic config, repo-rooted reader, and a seed blog post"
```

---

### Task 3: Keystatic admin UI and API routes

**Files:**
- Create: `app/app/keystatic/keystatic.ts`
- Create: `app/app/keystatic/layout.tsx`
- Create: `app/app/keystatic/[[...params]]/page.tsx`
- Create: `app/app/api/keystatic/[...params]/route.ts`

**Interfaces:** none — this is Keystatic's own boilerplate wiring, verified by the build succeeding and the route appearing in the build's route table, not by a unit test (it's a third-party editor UI, not application logic this project owns — per the phase-2 spec's testing section).

- [x] **Step 1: Create the admin app entry point**

Create `app/app/keystatic/keystatic.ts`:

```ts
"use client";

import { makePage } from "@keystatic/next/ui/app";
import config from "../../keystatic.config";

export default makePage(config);
```

- [x] **Step 2: Create the admin layout**

Create `app/app/keystatic/layout.tsx`:

```tsx
import KeystaticApp from "./keystatic";

export default function Layout() {
  return <KeystaticApp />;
}
```

- [x] **Step 3: Create the required catch-all page**

Create `app/app/keystatic/[[...params]]/page.tsx`:

```tsx
export default function Page() {
  return null;
}
```

- [x] **Step 4: Create the API route handler**

Create `app/app/api/keystatic/[...params]/route.ts`:

```ts
import { makeRouteHandler } from "@keystatic/next/route-handler";
import config from "../../../../keystatic.config";

export const { POST, GET } = makeRouteHandler({ config });
```

- [x] **Step 5: Run the full test suite and build**

Run: `cd app && npm test`
Expected: PASS — no existing test touches these new files.

Run: `cd app && npm run lint && npm run build`
Expected: both succeed. The build's route table should list `/keystatic`, `/keystatic/[[...params]]`, and `/api/keystatic/[...params]`.

- [x] **Step 6: Commit**

```bash
git add app/app/keystatic app/app/api/keystatic
git commit -m "feat: add Keystatic admin UI and API route"
```

---

### Task 4: Gate `/keystatic` and `/api/keystatic/*`

**Files:**
- Modify: `app/lib/route-gate.ts`
- Modify: `app/lib/route-gate.test.ts`

**Interfaces:**
- Consumes: `isGatedPath(pathname: string): boolean` — unchanged signature, just new gated prefixes.

- [x] **Step 1: Add the failing test cases**

In `app/lib/route-gate.test.ts`, add these cases to the existing `it.each` table (keep all existing cases):

```ts
    ["/keystatic", true],
    ["/keystatic/blog/hello-world", true],
    ["/api/keystatic/github/oauth/callback", true],
```

- [x] **Step 2: Run it to verify the new cases fail**

Run: `cd app && npx vitest run lib/route-gate.test.ts`
Expected: FAIL — the 3 new cases return `false` (not yet gated).

- [x] **Step 3: Add the new gated prefixes**

In `app/lib/route-gate.ts`, change:

```ts
const GATED_PREFIXES = ["/tools/bgm-looper", "/api/looper"];
```
to:
```ts
const GATED_PREFIXES = ["/tools/bgm-looper", "/api/looper", "/keystatic", "/api/keystatic"];
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run lib/route-gate.test.ts`
Expected: PASS — all cases (old and new) green.

- [x] **Step 5: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add app/lib/route-gate.ts app/lib/route-gate.test.ts
git commit -m "feat: gate /keystatic and /api/keystatic/* behind the existing password"
```

---

### Task 5: Login page `next` redirect param

**Files:**
- Modify: `app/middleware.ts`
- Modify: `app/app/tools/bgm-looper/login/page.tsx`
- Create: `app/app/tools/bgm-looper/login/page.test.tsx`

**Interfaces:** none new — this only changes where an existing redirect points, not any function signature.

Context: today, any unauthenticated request to a gated path redirects to `/tools/bgm-looper/login`, and logging in always sends the user to `/tools/bgm-looper` — so visiting `/keystatic` while logged out currently lands the user back on the *tool* after logging in, not `/keystatic`. This task carries the original path through as a `next` query param.

- [x] **Step 1: Update the middleware's redirect**

In `app/middleware.ts`, change:

```ts
    return NextResponse.redirect(new URL("/tools/bgm-looper/login", request.url));
```
to:
```ts
    const loginUrl = new URL("/tools/bgm-looper/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
```

- [x] **Step 2: Write the failing login page test**

Create `app/app/tools/bgm-looper/login/page.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginPage from "./page";

const pushMock = vi.fn();
let mockSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    pushMock.mockClear();
    mockSearch = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  async function submit() {
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "test123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  }

  it("redirects to the next param on success when it's a relative path", async () => {
    mockSearch = "next=%2Fkeystatic";
    render(<LoginPage />);
    await submit();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/keystatic"));
  });

  it("falls back to /tools/bgm-looper when next is missing", async () => {
    render(<LoginPage />);
    await submit();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/tools/bgm-looper"));
  });

  it("falls back to /tools/bgm-looper when next is not a relative path (open-redirect guard)", async () => {
    mockSearch = "next=https%3A%2F%2Fevil.example";
    render(<LoginPage />);
    await submit();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/tools/bgm-looper"));
  });
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `cd app && npx vitest run app/tools/bgm-looper/login/page.test.tsx`
Expected: FAIL — the current page always calls `router.push("/tools/bgm-looper")` regardless of `next`.

- [x] **Step 4: Update the login page**

Replace the contents of `app/app/tools/bgm-looper/login/page.tsx`:

```tsx
"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError("Invalid password");
      return;
    }
    const next = searchParams.get("next");
    router.push(next && next.startsWith("/") ? next : "/tools/bgm-looper");
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="border border-line px-2.5 py-1.5 text-fg"
      />
      <button type="submit" className="bg-accent px-2.5 py-1.5 font-semibold text-bg">
        Log in
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
```

`useSearchParams()` requires a `<Suspense>` boundary in the Next.js App Router (otherwise the build emits a warning and the route can't be statically analyzed) — this page was already effectively dynamic (behind auth, form-driven), so this has no behavioral downside.

- [x] **Step 5: Run it to verify it passes**

Run: `cd app && npx vitest run app/tools/bgm-looper/login/page.test.tsx`
Expected: PASS — all 3 cases green.

- [x] **Step 6: Run the full suite and build**

Run: `cd app && npm test`
Expected: PASS.

Run: `cd app && npm run lint && npm run build`
Expected: both succeed, no `useSearchParams` Suspense warning.

- [x] **Step 7: Commit**

```bash
git add app/middleware.ts "app/app/tools/bgm-looper/login/page.tsx" "app/app/tools/bgm-looper/login/page.test.tsx"
git commit -m "feat: carry a next redirect param through login so /keystatic returns you to /keystatic"
```

---

### Task 6: BlogList and PostBody presentational components

**Files:**
- Create: `app/components/blog/BlogList.tsx`
- Create: `app/components/blog/BlogList.test.tsx`
- Create: `app/components/blog/PostBody.tsx`
- Create: `app/components/blog/PostBody.test.tsx`

**Interfaces:**
- Produces: `BlogListPost` type (`{slug, title, date, summary, tags}`, all strings except `tags: readonly string[]`) and `BlogList({posts: BlogListPost[]})` — Task 7's `/blog` page must build this exact shape from the reader's output.
- Produces: `PostBody({title, date, children}: {title: string; date: string; children: React.ReactNode})` — deliberately takes `children` rather than an MDX source string, so `next-mdx-remote/rsc`'s `<MDXRemote>` (untestable under Vitest) is never imported inside a tested component — Task 7's `/blog/[slug]` page passes `<MDXRemote source={mdxSource} />` as `PostBody`'s `children`.

- [x] **Step 1: Write the failing BlogList test**

Create `app/components/blog/BlogList.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlogList } from "./BlogList";

describe("BlogList", () => {
  it("renders each post linking to /blog/[slug]", () => {
    render(
      <BlogList
        posts={[
          {
            slug: "hello-world",
            title: "Hello, World",
            date: "2026-08-01",
            summary: "First post.",
            tags: ["meta"],
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Hello, World" })).toHaveAttribute(
      "href",
      "/blog/hello-world",
    );
    expect(screen.getByText("First post.")).toBeInTheDocument();
    expect(screen.getByText("#meta")).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run components/blog/BlogList.test.tsx`
Expected: FAIL — `Cannot find module './BlogList'`

- [x] **Step 3: Implement BlogList**

Create `app/components/blog/BlogList.tsx`:

```tsx
import Link from "next/link";

export type BlogListPost = {
  slug: string;
  title: string;
  date: string;
  summary: string;
  tags: readonly string[];
};

export function BlogList({ posts }: { posts: BlogListPost[] }) {
  return (
    <ul className="mt-10 flex flex-col">
      {posts.map((post) => (
        <li
          key={post.slug}
          className="group border-t border-line py-7 transition-colors last:border-b hover:border-accent"
        >
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] tabular-nums text-accent">
            {post.date}
          </p>
          <Link
            href={`/blog/${post.slug}`}
            className="mt-2 block font-mono text-xl font-semibold tracking-tight transition-colors group-hover:text-accent"
          >
            {post.title}
          </Link>
          <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-fg/70">
            {post.summary}
          </p>
          {post.tags.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <li
                  key={tag}
                  className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted"
                >
                  #{tag}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run components/blog/BlogList.test.tsx`
Expected: PASS

- [x] **Step 5: Write the failing PostBody test**

Create `app/components/blog/PostBody.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostBody } from "./PostBody";

describe("PostBody", () => {
  it("renders the title, date, and passed-in body content", () => {
    render(
      <PostBody title="Hello, World" date="2026-08-01">
        <p>This is the body.</p>
      </PostBody>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Hello, World" })).toBeInTheDocument();
    expect(screen.getByText("2026-08-01")).toBeInTheDocument();
    expect(screen.getByText("This is the body.")).toBeInTheDocument();
  });
});
```

- [x] **Step 6: Run it to verify it fails**

Run: `cd app && npx vitest run components/blog/PostBody.test.tsx`
Expected: FAIL — `Cannot find module './PostBody'`

- [x] **Step 7: Implement PostBody**

Create `app/components/blog/PostBody.tsx`:

```tsx
export function PostBody({
  title,
  date,
  children,
}: {
  title: string;
  date: string;
  children: React.ReactNode;
}) {
  return (
    <article>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] tabular-nums text-accent">
        {date}
      </p>
      <h1 className="mt-4 font-mono text-3xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-10 flex max-w-xl flex-col gap-4 text-[0.9375rem] leading-relaxed text-fg/80">
        {children}
      </div>
    </article>
  );
}
```

Note this file imports nothing from `next-mdx-remote` — per the Global Constraints, that stays confined to Task 7's untested async `page.tsx`.

- [x] **Step 8: Run it to verify it passes**

Run: `cd app && npx vitest run components/blog/PostBody.test.tsx`
Expected: PASS

- [x] **Step 9: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [x] **Step 10: Commit**

```bash
git add app/components/blog
git commit -m "feat: add BlogList and PostBody presentational components"
```

---

### Task 7: `/blog` and `/blog/[slug]` pages

**Files:**
- Create: `app/app/(site)/blog/page.tsx`
- Create: `app/app/(site)/blog/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getReader()` from Task 2, `BlogList`/`BlogListPost` and `PostBody` from Task 6.

These two files are async Server Components (they `await` the reader) and are **not unit-tested directly** — per the Global Constraints, React Testing Library cannot render an async component, and this is exactly why Task 6 exists: all the testable logic already lives in `BlogList`/`PostBody`. These pages are thin read-then-render wrappers, verified by the build succeeding (Step 3) — which exercises the real reader against Task 2's real seed post, giving genuine end-to-end proof the content-path fix works, not just a unit-level assertion.

- [x] **Step 1: Implement the blog list page**

Create `app/app/(site)/blog/page.tsx`:

```tsx
import { getReader } from "../../../lib/keystatic-reader";
import { BlogList } from "../../../components/blog/BlogList";

export default async function BlogPage() {
  const reader = getReader();
  const posts = await reader.collections.blog.all();
  const sorted = [...posts].sort((a, b) =>
    (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
  );

  return (
    <section>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
        Writing
      </p>
      <h1 className="mt-4 font-mono text-3xl font-semibold tracking-tight">Blog</h1>
      <BlogList
        posts={sorted.map(({ slug, entry }) => ({
          slug,
          title: entry.title,
          date: entry.date ?? "",
          summary: entry.summary,
          tags: entry.tags,
        }))}
      />
    </section>
  );
}
```

- [x] **Step 2: Implement the single-post page**

Create `app/app/(site)/blog/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getReader } from "../../../../lib/keystatic-reader";
import { PostBody } from "../../../../components/blog/PostBody";

export async function generateStaticParams() {
  const reader = getReader();
  const slugs = await reader.collections.blog.list();
  return slugs.map((slug) => ({ slug }));
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const reader = getReader();
  const entry = await reader.collections.blog.read(slug);
  if (!entry) {
    notFound();
  }
  const mdxSource = await entry.content();

  return (
    <PostBody title={entry.title} date={entry.date ?? ""}>
      <MDXRemote source={mdxSource} />
    </PostBody>
  );
}
```

`params` is a `Promise` here (not a plain object) — required by Next.js 15's App Router API, which this project is on (`"next": "^15.0.0"` in `app/package.json`).

- [x] **Step 3: Run the full suite, lint, and build**

Run: `cd app && npm test`
Expected: PASS — no new test files in this task; existing ones (including Task 6's) still pass.

Run: `cd app && npm run lint && npm run build`
Expected: both succeed. The build output must show `/blog` and `/blog/hello-world` (from `generateStaticParams`, using Task 2's seed post) as statically generated routes — if `hello-world` is missing from the build's route list, the content-path resolution is broken and must be fixed before continuing (re-check Task 2's `getReader()` implementation against the Global Constraints' explanation).

- [x] **Step 4: Commit**

```bash
git add "app/app/(site)/blog"
git commit -m "feat: add /blog and /blog/[slug] pages"
```

---

### Task 8: Add Blog to site navigation

**Files:**
- Modify: `app/components/site/SiteHeader.tsx`
- Modify: `app/components/site/SiteHeader.test.tsx`

- [x] **Step 1: Add the failing assertion**

In `app/components/site/SiteHeader.test.tsx`, add inside the existing test:

```ts
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute("href", "/blog");
```

- [x] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run components/site/SiteHeader.test.tsx`
Expected: FAIL — no "Blog" link exists yet.

- [x] **Step 3: Add the nav link**

In `app/components/site/SiteHeader.tsx`, change:

```ts
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/projects", label: "Projects" },
  { href: "/resume", label: "Resume" },
  { href: "/contact", label: "Contact" },
];
```
to:
```ts
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/projects", label: "Projects" },
  { href: "/resume", label: "Resume" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
];
```

- [x] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run components/site/SiteHeader.test.tsx`
Expected: PASS

- [x] **Step 5: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add app/components/site/SiteHeader.tsx app/components/site/SiteHeader.test.tsx
git commit -m "feat: add Blog to site navigation"
```

---

### Task 9: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [x] **Step 1: Read the existing format**

Run: `cat CHANGELOG.md` (or Read the file) — match its existing `## [Unreleased]` heading style and `### Added`/`### Changed` subsection/bullet format exactly.

- [x] **Step 2: Add entries**

Under `## [Unreleased]`, add (adjust subsection headers to match whatever's already there — create `### Added` if it doesn't exist yet):

```markdown
### Added
- Blog, powered by Keystatic (git-backed CMS). Admin UI at `/keystatic`
  (behind the existing password). Public posts at `/blog`.
```

- [x] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add changelog entry for the blog"
```

---

### Task 10: Full-repo verification and manual-setup handoff

**Files:** none (verification only)

- [x] **Step 1: Run the full automated test suite**

Run: `cd app && npm test`
Expected: PASS — all tests across `lib/`, `components/blog/`, `components/site/`, `app/(site)/blog/*`, and the login page green.

- [x] **Step 2: Run lint and build**

Run: `cd app && npm run lint && npm run build`
Expected: both succeed. Confirm the build's route table includes `/blog`, `/blog/hello-world`, `/keystatic`, `/keystatic/[[...params]]`.

- [x] **Step 3: Start the dev server and verify gating via curl**

Run: `cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev`

Verify without a cookie:
- `GET /blog` and `GET /blog/hello-world` return 200 (public).
- `GET /keystatic` redirects (307/302) to `/tools/bgm-looper/login?next=%2Fkeystatic` — confirms both the new gating (Task 4) and the `next` param (Task 5) together.

Then verify the login round-trip carries `next` correctly: POST `/api/login` with the correct password, then using the returned cookie, `GET /keystatic` returns 200 (not a redirect).

Stop the dev server when done.

- [x] **Step 4: Report the manual setup steps to the human**

This step cannot be automated — report it as the final output of this plan, not as a commit. Tell the human:

> Code is merged. Before `/keystatic` works in production:
> 1. Pull this branch locally, run `APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev` from `app/`.
> 2. Visit `http://localhost:3000/keystatic`, log in with GitHub.
> 3. Click "Create GitHub App", name it, authorize it on `DataCrusade1999/supreme-enigma`.
> 4. Keystatic writes `KEYSTATIC_GITHUB_CLIENT_ID`, `KEYSTATIC_GITHUB_CLIENT_SECRET`, `KEYSTATIC_SECRET`, and `NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG` into a local `.env` (now correctly gitignored, per Task 1).
> 5. Copy those same 4 values into the Vercel project's environment variables (dashboard, not Terraform — deliberate, per the spec, to avoid a written-down copy of secrets anywhere in this repo's tracked files).
>
> If step 3 fails with a `401 {"error":"unauthorized"}` response instead of completing the GitHub App flow, that's the specific risk flagged in the spec (§6) — the fix is adding the exact failing callback path to `ALWAYS_ALLOWED_PATHS` in `app/lib/route-gate.ts` rather than un-gating the whole `/api/keystatic/*` prefix.

If any bug is found during Steps 1-3, fix it, re-run the relevant test, and commit with message `fix: <description>`. If everything passes, no commit is needed for this task beyond that report.
