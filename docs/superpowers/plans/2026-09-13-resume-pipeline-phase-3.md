# Resume Pipeline Phase 3 — Public Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public `/resume` and `/about` pages render the published resume from S3, and make `/resume.pdf` serve the real file — replacing the scaffold placeholder content that currently ships to production.

**Architecture:** One cached read helper wraps the S3 fetch of `resume/current.json` behind `unstable_cache` with a `resume` tag, which Phase 2's publish route already revalidates. Every consumer goes through that helper, and every consumer falls back to the existing placeholder content when the object is absent — which is the literal state of production on the day this ships, so it is a tested path rather than a defensive one. `/resume.pdf` becomes a route handler redirecting to a presigned GET.

**Tech Stack:** Next.js 16.3.4 (App Router, server components, `unstable_cache`), React 19, TypeScript, zod 4, AWS SDK v3, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-resume-pipeline-design.md` (§8 is this phase)

**Prerequisite:** Phase 2 (`docs/superpowers/plans/2026-09-13-resume-pipeline-phase-2.md`) is merged. This phase consumes `resumeSchema`, `Resume`, `CURRENT_JSON_KEY`, `CURRENT_PDF_KEY`, `resumeBucket`, `getObjectBytes`, `objectExists` and `presignDownloadFrom` from it.

It also relies on Phase 2 Task 1's `@/` resolve alias in `app/vitest.config.ts`. `tsconfig.json` maps `@/*` → `./*` and the route handlers use it, but **Vitest does not read tsconfig paths** — without that alias every `vi.mock("@/lib/…")` below fails to resolve. If `npx vitest run lib/resume-content.test.ts` reports `Failed to resolve import "@/lib/aws"`, the alias is missing; add it before going further.

**Closes:** issues #76 (Download PDF button on `/resume` 404s) and #78 (resume page ships template placeholder content to production).

## Global Constraints

- Branch from `dev`; PRs target `dev`. Do not work on `dev`, `stage`, or `main` directly.
- Commit messages end with: `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`
- PR descriptions end with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- Add a `CHANGELOG.md` entry under `## [Unreleased]`, and reference `Closes #76` and `Closes #78` in the PR body.
- App unit tests: `cd app && npm test` (Vitest only). **CI's `test` job runs Vitest *and* Playwright *and* lint** — `npm test` alone is not the gate.
- Local build needs `KEYSTATIC_GITHUB_CLIENT_ID`, `KEYSTATIC_GITHUB_CLIENT_SECRET` and `KEYSTATIC_SECRET` set to any non-empty value, or it dies after compiling with `Failed to collect configuration for /api/keystatic/[...params]`.
- **`cacheComponents` is off** — `app/next.config.mjs` sets only `redirects()`. The `"use cache"` directive is therefore unavailable, and `unstable_cache` is the mechanism. Turning the flag on is a repo-wide rendering change and is **out of scope**.
- **The public pages must never be gated.** `app/lib/route-gate.ts` gates `/api/resume`, and `matches()` requires a `/` boundary, so `/resume` and `/resume.pdf` stay public. Do not widen that prefix.
- Styling is **Tailwind CSS v4**, configured CSS-first in `app/app/globals.css`. There is no `tailwind.config.js`. Use the existing tokens (`text-fg`, `text-muted`, `text-accent`, `border-line`, `bg-bg`) and the twelve-column grid the other pages use.
- `app/TESTING.md` documents how to unit-test async server components. Read it before writing the page tests.
- Follow the "Merging a PR" sequence in `CLAUDE.md`, including reading inline review comments with `gh api --paginate`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `app/lib/resume-content.ts` | cached S3 read + placeholder fallback | **Create** |
| `app/lib/resume-content.test.ts` | tests for the above | **Create** |
| `app/content/resume.ts` | the placeholder fallback data | Modify: reshape to the schema |
| `app/app/(site)/resume/page.tsx` | public resume page | Modify: read from S3, add skills |
| `app/app/(site)/resume/page.test.tsx` | page tests | Modify |
| `app/app/(site)/about/page.tsx` | public about page | Modify: headline + summary from S3 |
| `app/app/(site)/about/page.test.tsx` | page tests | Modify |
| `app/app/resume.pdf/route.ts` | PDF download | **Create** |
| `app/app/resume.pdf/route.test.ts` | tests for the above | **Create** |
| `app/e2e/resume-public.spec.ts` | public-page e2e | **Create** |
| `CHANGELOG.md` | release notes | Modify |

One helper module rather than a read in each page: the two pages and the PDF route must agree on the bucket, the key, the cache tag and the fallback, and three copies of that agreement is three places for it to drift.

---

## Task 1: The cached resume read

**Files:**
- Create: `app/lib/resume-content.ts`
- Test: `app/lib/resume-content.test.ts`
- Modify: `app/content/resume.ts`

**Interfaces:**
- Consumes: `resumeSchema`, `Resume` (Phase 2 Task 1); `CURRENT_JSON_KEY`, `resumeBucket` (Phase 2 Task 2); `getObjectBytes`, `objectExists` (Phase 2 Task 3)
- Produces:
  - `RESUME_CACHE_TAG = "resume"`
  - `getPublishedResume(): Promise<{ resume: Resume; published: boolean }>`
  - `placeholderResume: Resume` (from `app/content/resume.ts`)

- [ ] **Step 1: Reshape the placeholder content to the schema**

`app/content/resume.ts` currently exports a bare `ResumeEntry[]`. The fallback has to be the same shape as a published resume so both branches render through identical markup.

Replace the file with:

```ts
import type { Resume } from "../lib/resume-schema";

// The fallback shown until a resume is published. Deliberately obvious
// placeholder copy: a visitor seeing this should be able to tell nothing real
// has been published yet, rather than believing these are actual roles.
export const placeholderResume: Resume = {
  headline: {
    name: "Ashutosh Pandey",
    title: "[Your title]",
    summary:
      "[One sentence on what you build and why it is worth building.]",
  },
  work: [
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
  ],
  skills: [
    { group: "Languages", items: ["[Add your languages]"] },
    { group: "Tools", items: ["[Add your tools]"] },
  ],
};
```

The old `ResumeEntry` type and `resume` export are removed. `Resume["work"][number]` is the replacement type; the resume page is the only consumer and Task 2 updates it.

- [ ] **Step 2: Write the failing test**

Create `app/lib/resume-content.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({ getObjectBytes: vi.fn(), objectExists: vi.fn() }));
// unstable_cache memoises across calls, which would make these assertions
// depend on test order. The identity wrapper keeps the cache-key contract
// (asserted separately below) without the memoisation.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));

import { getPublishedResume, RESUME_CACHE_TAG } from "./resume-content";
import { getObjectBytes, objectExists } from "@/lib/aws";
import { placeholderResume } from "@/content/resume";

const PUBLISHED = {
  headline: { name: "Real Name", title: "Real Title", summary: "Real summary." },
  work: [
    { role: "R", org: "O", start: "2025", end: "Present", bullets: ["shipped a thing"] },
  ],
  skills: [{ group: "Languages", items: ["TypeScript"] }],
};

describe("getPublishedResume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
  });

  it("returns the published resume when one exists", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(PUBLISHED)));

    const { resume, published } = await getPublishedResume();

    expect(published).toBe(true);
    expect(resume).toEqual(PUBLISHED);
  });

  it("falls back to the placeholder before the first publish", async () => {
    // This is the state of production on the day this ships, not a
    // theoretical edge case.
    vi.mocked(objectExists).mockResolvedValue(false);

    const { resume, published } = await getPublishedResume();

    expect(published).toBe(false);
    expect(resume).toEqual(placeholderResume);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("falls back rather than throwing when the stored JSON is corrupt", async () => {
    // A broken object must not take the whole portfolio down.
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from("not json"));

    const { resume, published } = await getPublishedResume();

    expect(published).toBe(false);
    expect(resume).toEqual(placeholderResume);
  });

  it("falls back when the stored JSON does not match the schema", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(getObjectBytes).mockResolvedValue(
      Buffer.from(JSON.stringify({ headline: { name: "only" } })),
    );

    const { published } = await getPublishedResume();
    expect(published).toBe(false);
  });

  it("falls back when the bucket is not configured at all", async () => {
    // The state during a local build and in CI: RESUME_BUCKET_NAME is unset,
    // so objectExists rejects with a serializer/credentials error rather than
    // returning false. If this is not caught, /resume and /about fail the
    // build on the exact path the fallback exists to cover.
    delete process.env.RESUME_BUCKET_NAME;
    vi.mocked(objectExists).mockRejectedValue(new Error("Bucket is required"));

    const { resume, published } = await getPublishedResume();

    expect(published).toBe(false);
    expect(resume).toEqual(placeholderResume);
  });

  it("reads from the resume bucket, not the audio bucket", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(PUBLISHED)));
    process.env.S3_BUCKET_NAME = "audio-bucket";

    await getPublishedResume();

    expect(vi.mocked(getObjectBytes).mock.calls[0][0]).toBe("resume-bucket");
    expect(vi.mocked(getObjectBytes).mock.calls[0][1]).toBe("resume/current.json");
  });

  it("uses the tag the publish route revalidates", () => {
    // Phase 2's publish route calls revalidateTag("resume"). If these two
    // strings drift, publishing silently stops updating the public pages.
    expect(RESUME_CACHE_TAG).toBe("resume");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd app && npx vitest run lib/resume-content.test.ts
```

Expected: FAIL — cannot resolve `./resume-content`.

- [ ] **Step 4: Implement**

Create `app/lib/resume-content.ts`:

```ts
import { unstable_cache } from "next/cache";
import { getObjectBytes, objectExists } from "./aws";
import { CURRENT_JSON_KEY, resumeBucket } from "./resume-keys";
import { resumeSchema, type Resume } from "./resume-schema";
import { placeholderResume } from "../content/resume";

// Phase 2's publish route calls revalidateTag("resume"). Both sides must agree
// on this string or publishing stops updating the public pages.
export const RESUME_CACHE_TAG = "resume";

// unstable_cache rather than the "use cache" directive: cacheComponents is off
// in next.config.mjs, so the directive is unavailable, and enabling it is a
// repo-wide rendering change well beyond this feature. See the design spec §8.
const readCurrent = unstable_cache(
  async (): Promise<{ resume: Resume; published: boolean }> => {
    // EVERYTHING is inside the try, including the existence probe. With
    // RESUME_BUCKET_NAME unset — which is the case during a local build and in
    // CI — resumeBucket() returns undefined and objectExists rejects with a
    // serializer or credentials error, not a NotFound. Probing outside the try
    // would let that propagate and fail the build on the very path this
    // fallback exists to cover.
    try {
      const bucket = resumeBucket();

      if (!(await objectExists(bucket, CURRENT_JSON_KEY))) {
        return { resume: placeholderResume, published: false };
      }

      const bytes = await getObjectBytes(bucket, CURRENT_JSON_KEY);
      const parsed = resumeSchema.safeParse(JSON.parse(bytes.toString("utf8")));
      if (!parsed.success) {
        return { resume: placeholderResume, published: false };
      }
      return { resume: parsed.data, published: true };
    } catch {
      // A corrupt object, an unset bucket, or missing credentials all fall
      // back rather than throwing: the resume is one section of a portfolio,
      // and a bad read must not take the whole page down.
      return { resume: placeholderResume, published: false };
    }
  },
  ["resume-current"],
  { tags: [RESUME_CACHE_TAG] },
);

export async function getPublishedResume(): Promise<{
  resume: Resume;
  published: boolean;
}> {
  return readCurrent();
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd app && npx vitest run lib/resume-content.test.ts
```

Expected: PASS, all six cases.

- [ ] **Step 6: Commit**

```bash
git add app/lib/resume-content.ts app/lib/resume-content.test.ts app/content/resume.ts
git commit -m "feat(resume): add the cached published-resume read

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 2: The public resume page

**Files:**
- Modify: `app/app/(site)/resume/page.tsx`
- Test: `app/app/(site)/resume/page.test.tsx`

**Interfaces:**
- Consumes: `getPublishedResume` (Task 1)
- Produces: `/resume` rendering the published timeline plus a new skills section

- [ ] **Step 1: Read the existing page and its test**

```bash
cd app && cat "app/(site)/resume/page.tsx" && cat "app/(site)/resume/page.test.tsx"
```

The timeline markup is reused as-is — `work` was designed to match the old `ResumeEntry` fields precisely so this page's grid does not change. What changes is where the data comes from, plus the new skills block.

- [ ] **Step 2: Write the failing test**

Replace the body of `app/app/(site)/resume/page.test.tsx` with:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/resume-content", () => ({ getPublishedResume: vi.fn() }));

import ResumePage from "./page";
import { getPublishedResume } from "@/lib/resume-content";

const PUBLISHED = {
  headline: { name: "Real Name", title: "Real Title", summary: "Real summary." },
  work: [
    {
      role: "QA Engineer",
      org: "Creowis",
      start: "July 2025",
      end: "Present",
      bullets: ["Built Playwright suites across a multi-tenant ERP."],
    },
  ],
  skills: [
    { group: "Languages", items: ["TypeScript", "Python"] },
    { group: "DevOps", items: ["Docker", "Terraform"] },
  ],
};

describe("ResumePage", () => {
  it("renders the published roles, dates, and bullets", async () => {
    vi.mocked(getPublishedResume).mockResolvedValue({ resume: PUBLISHED, published: true });

    render(await ResumePage());

    expect(screen.getByText("QA Engineer")).toBeInTheDocument();
    expect(screen.getByText("Creowis")).toBeInTheDocument();
    expect(screen.getByText(/July 2025/)).toBeInTheDocument();
    expect(
      screen.getByText("Built Playwright suites across a multi-tenant ERP."),
    ).toBeInTheDocument();
  });

  it("renders the skills section", async () => {
    vi.mocked(getPublishedResume).mockResolvedValue({ resume: PUBLISHED, published: true });

    render(await ResumePage());

    expect(screen.getByText("Languages")).toBeInTheDocument();
    expect(screen.getByText(/TypeScript/)).toBeInTheDocument();
    expect(screen.getByText("DevOps")).toBeInTheDocument();
  });

  it("shows the download link once a resume is published", async () => {
    vi.mocked(getPublishedResume).mockResolvedValue({ resume: PUBLISHED, published: true });

    render(await ResumePage());

    expect(screen.getByRole("link", { name: /download pdf/i })).toHaveAttribute(
      "href",
      "/resume.pdf",
    );
  });

  it("hides the download link before the first publish", async () => {
    // /resume.pdf 404s with nothing published. Offering a link to a 404 is
    // exactly the bug this closes (#76), so the link is conditional.
    vi.mocked(getPublishedResume).mockResolvedValue({
      resume: PUBLISHED,
      published: false,
    });

    render(await ResumePage());

    expect(screen.queryByRole("link", { name: /download pdf/i })).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd app && npx vitest run "app/(site)/resume/page.test.tsx"
```

Expected: FAIL — the page is synchronous and reads the removed `resume` export.

- [ ] **Step 4: Implement**

Replace `app/app/(site)/resume/page.tsx`:

```tsx
import { getPublishedResume } from "../../../lib/resume-content";
import { PageMasthead } from "../../../components/site/PageMasthead";

export default async function ResumePage() {
  const { resume, published } = await getPublishedResume();

  return (
    <section>
      <PageMasthead
        eyebrow="Timeline"
        title="Resume"
        right={
          // Conditional: /resume.pdf 404s until something is published, and a
          // link to a 404 is the bug this closes.
          published ? (
            <a
              href="/resume.pdf"
              download
              className="group inline-flex min-h-11 items-center gap-2 bg-fg px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
            >
              Download PDF
              <span
                aria-hidden="true"
                className="transition-transform duration-200 ease-out group-hover:translate-x-2 motion-reduce:transition-none"
              >
                →
              </span>
            </a>
          ) : null
        }
      />

      <ol className="mt-10">
        {resume.work.map((entry) => (
          <li
            key={`${entry.org}-${entry.start}`}
            className="grid grid-cols-12 gap-6 border-b border-line py-7"
          >
            <p className="col-span-12 text-xs uppercase tracking-[0.14em] tabular-nums text-accent md:col-span-2">
              {entry.start} — {entry.end}
            </p>

            <div className="col-span-12 md:col-span-6 md:col-start-3">
              <p className="text-base font-medium">{entry.role}</p>
              <p className="mt-1 text-sm text-muted">{entry.org}</p>
            </div>

            <ul className="col-span-12 flex flex-col gap-2.5 md:col-span-4 md:col-start-9">
              {entry.bullets.map((bullet) => (
                <li key={bullet} className="text-sm leading-relaxed text-muted">
                  {bullet}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <h2 className="mt-14 text-xs uppercase tracking-[0.14em] text-muted">Skills</h2>
      <dl className="mt-4 border-t border-line">
        {resume.skills.map((group) => (
          <div
            key={group.group}
            className="grid grid-cols-12 gap-6 border-b border-line py-5"
          >
            <dt className="col-span-12 text-xs uppercase tracking-[0.14em] text-accent md:col-span-2">
              {group.group}
            </dt>
            <dd className="col-span-12 text-sm leading-relaxed md:col-span-10">
              {group.items.join(" · ")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd app && npx vitest run "app/(site)/resume/page.test.tsx"
```

Expected: PASS, all four cases.

- [ ] **Step 6: Commit**

```bash
git add "app/app/(site)/resume/page.tsx" "app/app/(site)/resume/page.test.tsx"
git commit -m "feat(resume): render the published resume on /resume

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 3: The About page headline and summary

**Files:**
- Modify: `app/app/(site)/about/page.tsx`
- Test: `app/app/(site)/about/page.test.tsx`

**Interfaces:**
- Consumes: `getPublishedResume` (Task 1)
- Produces: `/about` showing the published headline and summary

Only the headline block changes. The `META` list, the `LoopRing`, and the second paragraph stay placeholder copy — they are not in the resume schema, and writing that copy is separate work the spec explicitly leaves out (§13, "writing About/resume copy").

- [ ] **Step 1: Write the failing test**

Replace the body of `app/app/(site)/about/page.test.tsx` with:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/resume-content", () => ({ getPublishedResume: vi.fn() }));

import AboutPage from "./page";
import { getPublishedResume } from "@/lib/resume-content";

const RESUME = {
  headline: {
    name: "Real Name",
    title: "QA Engineer & DevOps Operator",
    summary: "Builds reliable systems and removes manual toil.",
  },
  work: [{ role: "R", org: "O", start: "2025", end: "Present", bullets: ["b"] }],
  skills: [{ group: "Languages", items: ["TypeScript"] }],
};

describe("AboutPage", () => {
  it("renders the published title and summary", async () => {
    vi.mocked(getPublishedResume).mockResolvedValue({ resume: RESUME, published: true });

    render(await AboutPage());

    expect(screen.getByText("QA Engineer & DevOps Operator")).toBeInTheDocument();
    expect(
      screen.getByText("Builds reliable systems and removes manual toil."),
    ).toBeInTheDocument();
  });

  it("still renders before the first publish", async () => {
    // The page must not error or go blank when nothing is published — it is
    // the live state of production until the first publish.
    vi.mocked(getPublishedResume).mockResolvedValue({
      resume: RESUME,
      published: false,
    });

    render(await AboutPage());

    expect(screen.getByText("About")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run "app/(site)/about/page.test.tsx"
```

Expected: FAIL — the page is synchronous and does not call `getPublishedResume`.

- [ ] **Step 3: Implement**

In `app/app/(site)/about/page.tsx`, add the import, make the component async, and replace the two placeholder paragraphs in the left-hand column. Leave `META`, the `LoopRing`, and the closing paragraph untouched.

```tsx
import { getPublishedResume } from "../../../lib/resume-content";
```

```tsx
export default async function AboutPage() {
  const { resume } = await getPublishedResume();
```

and, inside the left column, replace the first two `<p>` elements with:

```tsx
          <p className="font-display text-3xl leading-[1.15] md:text-[2.5rem]">
            {resume.headline.title}
          </p>
          <p className="mt-8 text-base leading-relaxed text-fg/80">
            {resume.headline.summary}
          </p>
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run "app/(site)/about/page.test.tsx"
```

Expected: PASS, both cases.

- [ ] **Step 5: Commit**

```bash
git add "app/app/(site)/about/page.tsx" "app/app/(site)/about/page.test.tsx"
git commit -m "feat(resume): drive the About headline from the published resume

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 4: The `/resume.pdf` route handler

**Files:**
- Create: `app/app/resume.pdf/route.ts`
- Test: `app/app/resume.pdf/route.test.ts`

**Interfaces:**
- Consumes: `CURRENT_PDF_KEY`, `resumeBucket` (Phase 2 Task 2); `objectExists`, `presignDownloadFrom` (Phase 2 Task 3)
- Produces: `GET /resume.pdf` → 307 redirect to a presigned GET, or 404

A route segment literally named `resume.pdf` serves the path `/resume.pdf`. The dot is legal in a segment name and needs no config.

- [ ] **Step 1: Write the failing test**

Create `app/app/resume.pdf/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  objectExists: vi.fn(),
  presignDownloadFrom: vi.fn(),
}));

import { GET } from "./route";
import { objectExists, presignDownloadFrom } from "@/lib/aws";

describe("GET /resume.pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
  });

  it("redirects to a presigned URL when a resume is published", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(presignDownloadFrom).mockResolvedValue("https://signed.example/get");

    const res = await GET();

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://signed.example/get");
    expect(vi.mocked(presignDownloadFrom).mock.calls[0]).toEqual([
      "resume-bucket",
      "resume/current.pdf",
    ]);
  });

  it("404s before the first publish instead of redirecting nowhere", async () => {
    vi.mocked(objectExists).mockResolvedValue(false);

    const res = await GET();

    expect(res.status).toBe(404);
    expect(presignDownloadFrom).not.toHaveBeenCalled();
  });

  it("404s rather than 500ing when the bucket is not configured", async () => {
    // CI runs with RESUME_BUCKET_NAME unset, and the Playwright spec asserts
    // this route answers 307 or 404. An uncaught probe error would make it a
    // 500 and fail that assertion.
    delete process.env.RESUME_BUCKET_NAME;
    vi.mocked(objectExists).mockRejectedValue(new Error("Bucket is required"));

    const res = await GET();

    expect(res.status).toBe(404);
  });

  it("is not cached, because the presigned URL expires", async () => {
    // A cached 307 would hand out a stale signed URL long after its 300s TTL,
    // producing an opaque S3 AccessDenied for the visitor.
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(presignDownloadFrom).mockResolvedValue("https://signed.example/get");

    const res = await GET();

    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run app/resume.pdf/route.test.ts
```

Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement**

Create `app/app/resume.pdf/route.ts`:

```ts
import { NextResponse } from "next/server";
import { objectExists, presignDownloadFrom } from "@/lib/aws";
import { CURRENT_PDF_KEY, resumeBucket } from "@/lib/resume-keys";

// The presigned URL lives 300 seconds, so this response must never be cached —
// a cached redirect would hand out an expired signature and the visitor would
// see an opaque S3 AccessDenied instead of a download.
export const dynamic = "force-dynamic";

export async function GET() {
  // "Nothing to download" and "S3 is not configured here" are the same answer
  // to a visitor: a 404. Letting the probe throw instead would surface as a
  // 500 wherever RESUME_BUCKET_NAME is unset — which includes CI, where the
  // e2e spec asserts this route answers 307 or 404.
  try {
    const bucket = resumeBucket();

    if (!(await objectExists(bucket, CURRENT_PDF_KEY))) {
      return new NextResponse("No resume has been published yet.", { status: 404 });
    }

    const url = await presignDownloadFrom(bucket, CURRENT_PDF_KEY);
    return NextResponse.redirect(url, {
      status: 307,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return new NextResponse("No resume has been published yet.", { status: 404 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run app/resume.pdf/route.test.ts
```

Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add app/app/resume.pdf/route.ts app/app/resume.pdf/route.test.ts
git commit -m "feat(resume): serve /resume.pdf from the published PDF

Closes the dead download link: the route redirects to a presigned GET
of resume/current.pdf, and 404s cleanly before the first publish.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 5: End-to-end coverage, CHANGELOG, and the PR

**Files:**
- Create: `app/e2e/resume-public.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 1-4
- Produces: merged Phase 3, closing #76 and #78

- [ ] **Step 1: Write the spec**

Create `app/e2e/resume-public.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("the resume page is public and renders a timeline", async ({ page }) => {
  await page.goto("/resume");
  await expect(page).toHaveURL(/\/resume$/);
  await expect(page.getByRole("heading", { name: "Resume" })).toBeVisible();
  await expect(page.getByRole("listitem").first()).toBeVisible();
});

test("the resume page shows a skills section", async ({ page }) => {
  await page.goto("/resume");
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
});

test("the about page is public and renders", async ({ page }) => {
  await page.goto("/about");
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
});

test("/resume.pdf answers rather than hanging or 500ing", async ({ request }) => {
  // In CI no resume is published and RESUME_BUCKET_NAME may be unset, so 404
  // is the expected answer. What matters is that the route exists and does
  // not throw — a 500 here is a real failure.
  const res = await request.get("/resume.pdf", { maxRedirects: 0 });
  expect([307, 404]).toContain(res.status());
});
```

Note the existing `app/e2e/a11y.spec.ts` already scans `/resume` and `/about` with axe — run the whole suite, because the new skills markup must not introduce a violation.

- [ ] **Step 2: Run it**

```bash
cd app && npx playwright test e2e/resume-public.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run the whole gate**

```bash
cd app && npm test && npm run test:e2e && npm run lint && npx tsc --noEmit
```

Expected: all PASS, including the a11y scan of `/resume` and `/about`. The e2e suite can flake on a cold server immediately after a rebuild — re-run once warm before investigating.

- [ ] **Step 4: Verify the build**

```bash
cd app && KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build
```

Expected: a successful build. `/resume` and `/about` now perform an S3 read at build time; with `RESUME_BUCKET_NAME` unset locally the fallback path runs, which is exactly the behaviour Task 1's tests pin.

- [ ] **Step 5: Add the CHANGELOG entry**

Under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Added

- `/resume` and `/about` now render the resume published through the admin
  pipeline, read from `resume/current.json` in S3 behind a cached, tagged read
  that the publish route revalidates. Both fall back to the placeholder content
  when nothing has been published, which is a tested path rather than a
  defensive one. The resume page gains a skills section.

### Fixed

- The `/resume` page's Download PDF link no longer 404s. `/resume.pdf` is a
  route handler that redirects to a 300-second presigned GET of the published
  PDF, and the link is hidden entirely until a resume exists to download.
```

- [ ] **Step 6: Commit and open the PR**

```bash
git add app/e2e/resume-public.spec.ts CHANGELOG.md
git commit -m "test(e2e): cover the public resume pages

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin <branch>
```

Open the PR against `dev` following `.github/pull_request_template.md`, with `Closes #76` and `Closes #78` in the body. Write the body to a file and use `--body-file`.

- [ ] **Step 7: Merge per the standing sequence**

Green `test`, then `aws-devops-agent/release-readiness-review` reporting `change approved` via the **commit status** API, then read the inline comments with `gh api --paginate`, then squash-merge, then `git checkout dev && git pull --ff-only origin dev`.

- [ ] **Step 8: Verify against the deployment**

After the merge deploys to `dev`, open `/resume` and `/about`. Before anything is published they must show placeholder content with **no** Download PDF button, and `/resume.pdf` must return 404 rather than a 500.

Then publish a resume from production (Phase 2 Task 12 Step 7) and confirm on `https://bgm-looper.vercel.app`:

- `/resume` shows the real roles and skills.
- The Download PDF button is present and downloads the actual PDF.
- `/about` shows the real title and summary.
- The change appears without a redeploy — that is `revalidateTag("resume")` working. If it does not, check that `RESUME_CACHE_TAG` and the publish route's literal still match; that drift is silent and this is the only place it shows.

---

## After Phase 3

The pipeline is complete. Remaining known gaps, none of which this plan covers:

- **About page `META` and the closing paragraph are still placeholder copy.** They are not in the resume schema — writing them is a content task, not an engineering one.
- **Education and certifications are deferred** (spec §14). Adding them is a schema extension plus one render block, with no pipeline change.
- **The Lambda execution role still has bucket-wide S3 access** (`aws_iam_role_policy.lambda_s3`, `<bucket>/*`). Scoping it to `uploads/*` and `outputs/*` would close the last stray-write vector — noted during the Phase 1 review and deliberately left out as a live change to the audio processing path.
