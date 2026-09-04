# Portfolio Newsletter (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a newsletter to the portfolio site — a public archive of past issues (`/newsletter`, Keystatic-managed, same pattern as the blog) plus a Buttondown subscribe embed and a gated admin page that sends an issue via Buttondown's API on manual confirmation.

**Architecture:** A new `newsletter` Keystatic collection alongside the existing `blog` collection, reusing the same repo-rooted reader. A new `app/lib/buttondown.ts` module is the only code that talks to Buttondown's REST API (list-and-filter for "already sent" lookups, since Buttondown has no server-side slug filter; create-and-send for the actual send). A gated `/newsletter-admin` page and `/api/newsletter/send` route provide the manual send trigger — the API route re-reads content fresh and re-checks sent-status immediately before sending, so nothing but a deliberate click ever emails subscribers.

**Tech Stack:** No new npm dependency — Buttondown's API is a plain REST/JSON API called via the runtime's built-in `fetch`.

Every Buttondown API detail in this plan (auth header format, request/response schemas, the `X-API-Version`/`X-Buttondown-Live-Dangerously` header behavior, and the absence of a server-side `slug` filter on `GET /v1/emails`) was verified against Buttondown's public OpenAPI spec (`github.com/buttondown/openapi`, `openapi.json`) and its "Safer defaults for the email creation API" documentation — not assumed from general REST API conventions.

## Global Constraints

- Total AWS spend must stay under 200 INR/month. This plan touches no AWS resource — Buttondown's free tier and this app's own Next.js routes on Vercel, both already in use.
- No new npm dependency — Buttondown is called via the runtime's built-in `fetch`, no SDK.
- `/newsletter-admin` and `/api/newsletter/*` reuse the existing shared-password cookie via `app/lib/route-gate.ts` — no new auth mechanism.
- Newsletter content lives at `<repo-root>/content/newsletter/*.mdx` — same repo-root-relative mechanism as `content/blog/*.mdx`, for the same reason (Keystatic GitHub-mode API paths are repo-root-relative; Vercel's `root_directory = "app"` makes this app's own `process.cwd()` be `app/`). The existing `getReader()` in `app/lib/keystatic-reader.ts` already handles this for any collection registered in `keystatic.config.ts` — no changes needed there.
- `BUTTONDOWN_API_KEY` is server-only (no `NEXT_PUBLIC_` prefix), read only inside `app/lib/buttondown.ts`, and that module throws immediately if it's unset rather than silently no-op-ing.
- Every Buttondown API call sends `Authorization: Token <key>` (verified auth scheme) and `X-API-Version: 2026-04-01` (opts into Buttondown's safer defaults, where an email's `status` defaults to `draft` instead of immediately queuing to send). Any request that explicitly sets `status: "about_to_send"` must also send `X-Buttondown-Live-Dangerously: true` — `sendIssue` always sends both, unconditionally, rather than relying on a "confirmed once per API key" carve-out.
- `GET /v1/emails` has **no** server-side `slug` filter parameter (verified against the real OpenAPI schema — do not add one). "Already sent" lookups list emails and filter by `slug` client-side, following the response's `next` field until it's `null`.
- Relative imports (not the `@/*` alias) for anything covered by a Vitest test, per existing repo convention.
- `next-mdx-remote/rsc`'s `<MDXRemote>` is a React-Server-Component-only construct and cannot render under Vitest/jsdom. It must only ever be imported inside the untested async `page.tsx` files — never inside a component that has its own test file.
- Newsletter content authored via `fields.mdx()` must stay plain-Markdown-only in practice (no custom JSX components) — Buttondown's parser renders Markdown/HTML, not React/MDX. This is documented in the Keystatic field's label, not code-enforced.
- The send flow is manual only: `/api/newsletter/send` is only ever called by an explicit button click behind the password gate. Nothing in this plan wires an automatic send to a git commit or a build.

---

### Task 1: Keystatic newsletter collection and seed issue

**Files:**
- Modify: `app/keystatic.config.ts`
- Create: `content/newsletter/hello-newsletter.mdx` (repo root — sibling to `app/`, **not** inside it, same placement as `content/blog/`)

**Interfaces:**
- Produces: the `newsletter` collection schema (`title: string`, `date: string | null`, `summary: string`, `content: () => Promise<string>`) — Tasks 7 and 8 depend on exactly these field names and shapes. Same field types as the existing `blog` collection, minus `tags`.

- [ ] **Step 1: Add the newsletter collection to the Keystatic config**

Modify `app/keystatic.config.ts` — add a `newsletter` collection alongside the existing `blog` one:

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
    newsletter: collection({
      label: "Newsletter",
      slugField: "title",
      path: "content/newsletter/*",
      format: { contentField: "content" },
      schema: {
        title: fields.slug({ name: { label: "Title" } }),
        date: fields.date({ label: "Date" }),
        summary: fields.text({ label: "Summary" }),
        content: fields.mdx({
          label: "Content",
          description:
            "Plain Markdown only — no custom JSX components. This body is also sent as an email via Buttondown, which cannot render JSX.",
        }),
      },
    }),
  },
});
```

- [ ] **Step 2: Create the seed issue**

Create `content/newsletter/hello-newsletter.mdx` **at the repo root** (sibling to `app/`, not inside it):

```mdx
---
title: Hello, newsletter
date: 2026-08-01
summary: The first issue of this newsletter — edit or delete this any time from /keystatic.
---

This is the first issue archived on this site. Future issues get written
here in MDX (keep it to plain Markdown — this body is also sent as an
email via Buttondown, which can't render custom JSX components) and sent
from `/newsletter-admin` once you're ready.
```

- [ ] **Step 3: Verify the config is valid TypeScript**

Run: `cd app && npx tsc --noEmit`
Expected: no new errors (the existing blog collection's types still check; the new newsletter collection is structurally identical).

- [ ] **Step 4: Commit**

```bash
git add app/keystatic.config.ts content/newsletter/hello-newsletter.mdx
git commit -m "feat: add newsletter Keystatic collection and a seed issue"
```

---

### Task 2: Buttondown API client

**Files:**
- Create: `app/lib/buttondown.ts`
- Create: `app/lib/buttondown.test.ts`

**Interfaces:**
- Produces: `isIssueSent(slug: string): Promise<boolean>` and `sendIssue({slug, subject, body}: {slug: string; subject: string; body: string}): Promise<void>` — Task 3's API route imports both, not any lower-level Buttondown detail.
- Both throw (never silently resolve) on a non-success response from Buttondown, or if `BUTTONDOWN_API_KEY` is unset.

- [ ] **Step 1: Write the failing tests**

Create `app/lib/buttondown.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isIssueSent, sendIssue } from "./buttondown";

describe("buttondown", () => {
  beforeEach(() => {
    vi.stubEnv("BUTTONDOWN_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("isIssueSent", () => {
    it("returns true when an email with a matching slug exists", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            results: [{ id: "1", slug: "issue-one", subject: "Issue One", status: "sent" }],
            next: null,
          }),
        }),
      );
      await expect(isIssueSent("issue-one")).resolves.toBe(true);
    });

    it("returns false when no email matches, following pagination", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [{ id: "1", slug: "other-issue", subject: "Other", status: "sent" }],
            next: "https://api.buttondown.com/v1/emails?page=2",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [], next: null }),
        });
      vi.stubGlobal("fetch", fetchMock);
      await expect(isIssueSent("issue-one")).resolves.toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws when the list request fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" }),
      );
      await expect(isIssueSent("issue-one")).rejects.toThrow();
    });
  });

  describe("sendIssue", () => {
    it("posts the expected request shape and headers", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 201,
        json: async () => ({ id: "1" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      await sendIssue({ slug: "issue-one", subject: "Issue One", body: "Hello" });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.buttondown.com/v1/emails",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            subject: "Issue One",
            slug: "issue-one",
            body: "Hello",
            status: "about_to_send",
          }),
        }),
      );
      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers).toMatchObject({
        Authorization: "Token test-key",
        "X-API-Version": "2026-04-01",
        "X-Buttondown-Live-Dangerously": "true",
      });
    });

    it("throws when the response status is not 201", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ status: 409, text: async () => "conflict" }),
      );
      await expect(
        sendIssue({ slug: "issue-one", subject: "Issue One", body: "Hello" }),
      ).rejects.toThrow();
    });
  });

  it("throws when BUTTONDOWN_API_KEY is not set", async () => {
    vi.unstubAllEnvs();
    await expect(isIssueSent("issue-one")).rejects.toThrow("BUTTONDOWN_API_KEY");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run lib/buttondown.test.ts`
Expected: FAIL — `Cannot find module './buttondown'`

- [ ] **Step 3: Implement the Buttondown client**

Create `app/lib/buttondown.ts`:

```ts
const BUTTONDOWN_API_BASE = "https://api.buttondown.com/v1";

function getApiKey(): string {
  const key = process.env.BUTTONDOWN_API_KEY;
  if (!key) {
    throw new Error("BUTTONDOWN_API_KEY is not set");
  }
  return key;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Token ${getApiKey()}`,
    "Content-Type": "application/json",
    "X-API-Version": "2026-04-01",
  };
}

type ButtondownEmail = {
  id: string;
  slug: string | null;
  subject: string;
  status: string;
};

type ButtondownEmailPage = {
  results: ButtondownEmail[];
  next: string | null;
};

export async function isIssueSent(slug: string): Promise<boolean> {
  let url: string | null = `${BUTTONDOWN_API_BASE}/emails?excluded_fields=body`;
  while (url) {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      throw new Error(`Buttondown list emails failed: ${res.status} ${await res.text()}`);
    }
    const page: ButtondownEmailPage = await res.json();
    if (page.results.some((email) => email.slug === slug)) {
      return true;
    }
    url = page.next;
  }
  return false;
}

export async function sendIssue({
  slug,
  subject,
  body,
}: {
  slug: string;
  subject: string;
  body: string;
}): Promise<void> {
  const res = await fetch(`${BUTTONDOWN_API_BASE}/emails`, {
    method: "POST",
    headers: {
      ...headers(),
      "X-Buttondown-Live-Dangerously": "true",
    },
    body: JSON.stringify({
      subject,
      slug,
      body,
      status: "about_to_send",
    }),
  });
  if (res.status !== 201) {
    throw new Error(`Buttondown send failed: ${res.status} ${await res.text()}`);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run lib/buttondown.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/lib/buttondown.ts app/lib/buttondown.test.ts
git commit -m "feat: add Buttondown API client (list-and-filter lookup, create-and-send)"
```

---

### Task 3: Gate `/newsletter-admin` and `/api/newsletter/*`

**Files:**
- Modify: `app/lib/route-gate.ts`
- Modify: `app/lib/route-gate.test.ts`

**Interfaces:**
- Consumes: `isGatedPath(pathname: string): boolean` — unchanged signature, just new gated prefixes.

- [ ] **Step 1: Add the failing test cases**

In `app/lib/route-gate.test.ts`, add these cases to the existing `it.each` table (keep all existing cases):

```ts
    ["/newsletter-admin", true],
    ["/newsletter-admin/anything", true],
    ["/api/newsletter/send", true],
```

- [ ] **Step 2: Run it to verify the new cases fail**

Run: `cd app && npx vitest run lib/route-gate.test.ts`
Expected: FAIL — the 3 new cases return `false` (not yet gated).

- [ ] **Step 3: Add the new gated prefixes**

In `app/lib/route-gate.ts`, change:

```ts
const GATED_PREFIXES = ["/tools/bgm-looper", "/api/looper", "/keystatic", "/api/keystatic"];
```
to:
```ts
const GATED_PREFIXES = [
  "/tools/bgm-looper",
  "/api/looper",
  "/keystatic",
  "/api/keystatic",
  "/newsletter-admin",
  "/api/newsletter",
];
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run lib/route-gate.test.ts`
Expected: PASS — all cases (old and new) green.

- [ ] **Step 5: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/lib/route-gate.ts app/lib/route-gate.test.ts
git commit -m "feat: gate /newsletter-admin and /api/newsletter/* behind the existing password"
```

---

### Task 4: `/api/newsletter/send` route

**Files:**
- Create: `app/app/api/newsletter/send/route.ts`
- Create: `app/app/api/newsletter/send/route.test.ts`

**Interfaces:**
- Consumes: `getReader()` from `app/lib/keystatic-reader.ts` (Phase 2), `isIssueSent`/`sendIssue` from `app/lib/buttondown.ts` (Task 2).
- Produces: `POST /api/newsletter/send` accepting `{slug: string}`, returning `200 {ok: true}` on success, `400` (missing slug), `404` (unknown slug), `409` (already sent — `sendIssue` is *not* called in this case), or `502` (Buttondown send failed) with `{error: string}`.

- [ ] **Step 1: Write the failing tests**

Create `app/app/api/newsletter/send/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mockRead = vi.fn();
const mockIsIssueSent = vi.fn();
const mockSendIssue = vi.fn();

vi.mock("../../../../lib/keystatic-reader", () => ({
  getReader: () => ({
    collections: { newsletter: { read: mockRead } },
  }),
}));

vi.mock("../../../../lib/buttondown", () => ({
  isIssueSent: (...args: unknown[]) => mockIsIssueSent(...args),
  sendIssue: (...args: unknown[]) => mockSendIssue(...args),
}));

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/newsletter/send", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/newsletter/send", () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockIsIssueSent.mockReset();
    mockSendIssue.mockReset();
  });

  it("returns 400 when slug is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the issue doesn't exist", async () => {
    mockRead.mockResolvedValue(null);
    const res = await POST(makeRequest({ slug: "missing" }));
    expect(res.status).toBe(404);
  });

  it("returns 409 and does not call sendIssue when already sent", async () => {
    mockRead.mockResolvedValue({
      title: "Issue One",
      content: async () => "body text",
    });
    mockIsIssueSent.mockResolvedValue(true);
    const res = await POST(makeRequest({ slug: "issue-one" }));
    expect(res.status).toBe(409);
    expect(mockSendIssue).not.toHaveBeenCalled();
  });

  it("sends and returns 200 on the happy path", async () => {
    mockRead.mockResolvedValue({
      title: "Issue One",
      content: async () => "body text",
    });
    mockIsIssueSent.mockResolvedValue(false);
    mockSendIssue.mockResolvedValue(undefined);
    const res = await POST(makeRequest({ slug: "issue-one" }));
    expect(res.status).toBe(200);
    expect(mockSendIssue).toHaveBeenCalledWith({
      slug: "issue-one",
      subject: "Issue One",
      body: "body text",
    });
  });

  it("returns 502 with the error message when sendIssue throws", async () => {
    mockRead.mockResolvedValue({
      title: "Issue One",
      content: async () => "body text",
    });
    mockIsIssueSent.mockResolvedValue(false);
    mockSendIssue.mockRejectedValue(new Error("Buttondown send failed: 500 oops"));
    const res = await POST(makeRequest({ slug: "issue-one" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("Buttondown send failed");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run app/api/newsletter/send/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implement the route**

Create `app/app/api/newsletter/send/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getReader } from "../../../../lib/keystatic-reader";
import { isIssueSent, sendIssue } from "../../../../lib/buttondown";

export async function POST(request: Request) {
  const { slug } = await request.json();
  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  const reader = getReader();
  const entry = await reader.collections.newsletter.read(slug);
  if (!entry) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const alreadySent = await isIssueSent(slug);
  if (alreadySent) {
    return NextResponse.json({ error: "This issue has already been sent" }, { status: 409 });
  }

  const body = await entry.content();
  try {
    await sendIssue({ slug, subject: entry.title, body });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run app/api/newsletter/send/route.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/app/api/newsletter
git commit -m "feat: add /api/newsletter/send with a re-check-before-send guard"
```

---

### Task 5: IssueList and IssueBody presentational components

**Files:**
- Create: `app/components/newsletter/IssueList.tsx`
- Create: `app/components/newsletter/IssueList.test.tsx`
- Create: `app/components/newsletter/IssueBody.tsx`
- Create: `app/components/newsletter/IssueBody.test.tsx`

**Interfaces:**
- Produces: `IssueListItem` type (`{slug, title, date, summary}`, all strings) and `IssueList({issues: IssueListItem[]})` — Task 7's `/newsletter` page must build this exact shape from the reader's output.
- Produces: `IssueBody({title, date, children}: {title: string; date: string; children: React.ReactNode})` — takes `children` rather than an MDX source string, so `next-mdx-remote/rsc`'s `<MDXRemote>` (untestable under Vitest) is never imported inside a tested component — Task 7's `/newsletter/[slug]` page passes `<MDXRemote source={mdxSource} />` as `IssueBody`'s `children`.

- [ ] **Step 1: Write the failing IssueList test**

Create `app/components/newsletter/IssueList.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssueList } from "./IssueList";

describe("IssueList", () => {
  it("renders each issue linking to /newsletter/[slug]", () => {
    render(
      <IssueList
        issues={[
          {
            slug: "hello-newsletter",
            title: "Hello, newsletter",
            date: "2026-08-01",
            summary: "First issue.",
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Hello, newsletter" })).toHaveAttribute(
      "href",
      "/newsletter/hello-newsletter",
    );
    expect(screen.getByText("First issue.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run components/newsletter/IssueList.test.tsx`
Expected: FAIL — `Cannot find module './IssueList'`

- [ ] **Step 3: Implement IssueList**

Create `app/components/newsletter/IssueList.tsx`:

```tsx
import Link from "next/link";

export type IssueListItem = {
  slug: string;
  title: string;
  date: string;
  summary: string;
};

export function IssueList({ issues }: { issues: IssueListItem[] }) {
  return (
    <ul className="mt-10 flex flex-col">
      {issues.map((issue) => (
        <li
          key={issue.slug}
          className="group border-t border-line py-7 transition-colors last:border-b hover:border-accent"
        >
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] tabular-nums text-accent">
            {issue.date}
          </p>
          <Link
            href={`/newsletter/${issue.slug}`}
            className="mt-2 block font-mono text-xl font-semibold tracking-tight transition-colors group-hover:text-accent"
          >
            {issue.title}
          </Link>
          <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-fg/70">
            {issue.summary}
          </p>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run components/newsletter/IssueList.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing IssueBody test**

Create `app/components/newsletter/IssueBody.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssueBody } from "./IssueBody";

describe("IssueBody", () => {
  it("renders the title, date, and passed-in body content", () => {
    render(
      <IssueBody title="Hello, newsletter" date="2026-08-01">
        <p>This is the body.</p>
      </IssueBody>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Hello, newsletter" })).toBeInTheDocument();
    expect(screen.getByText("2026-08-01")).toBeInTheDocument();
    expect(screen.getByText("This is the body.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd app && npx vitest run components/newsletter/IssueBody.test.tsx`
Expected: FAIL — `Cannot find module './IssueBody'`

- [ ] **Step 7: Implement IssueBody**

Create `app/components/newsletter/IssueBody.tsx`:

```tsx
export function IssueBody({
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

This file imports nothing from `next-mdx-remote` — per the Global Constraints, that stays confined to Task 7's untested async `page.tsx`.

- [ ] **Step 8: Run it to verify it passes**

Run: `cd app && npx vitest run components/newsletter/IssueBody.test.tsx`
Expected: PASS

- [ ] **Step 9: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add app/components/newsletter/IssueList.tsx app/components/newsletter/IssueList.test.tsx app/components/newsletter/IssueBody.tsx app/components/newsletter/IssueBody.test.tsx
git commit -m "feat: add IssueList and IssueBody presentational components"
```

---

### Task 6: SubscribeForm component

**Files:**
- Create: `app/components/newsletter/SubscribeForm.tsx`
- Create: `app/components/newsletter/SubscribeForm.test.tsx`

**Interfaces:**
- Produces: `SubscribeForm()` (no props) — Task 7's `/newsletter` page renders it directly, no data passed in.

The Buttondown username used in the form's `action` URL is a constant in this file, not an env var — it's public information (it's part of a public URL), consistent with treating it as configuration baked in at the point of use rather than secret. Update `BUTTONDOWN_USERNAME` below once the real Buttondown account exists (Task 9 documents this as part of the manual handoff).

- [ ] **Step 1: Write the failing test**

Create `app/components/newsletter/SubscribeForm.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubscribeForm } from "./SubscribeForm";

describe("SubscribeForm", () => {
  it("renders a form posting to Buttondown's embed-subscribe endpoint with an email input", () => {
    render(<SubscribeForm />);
    const form = screen.getByRole("form", { name: "Subscribe to the newsletter" });
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute(
      "action",
      expect.stringContaining("buttondown.com/api/emails/embed-subscribe/"),
    );
    expect(screen.getByPlaceholderText("you@example.com")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run components/newsletter/SubscribeForm.test.tsx`
Expected: FAIL — `Cannot find module './SubscribeForm'`

- [ ] **Step 3: Implement SubscribeForm**

Create `app/components/newsletter/SubscribeForm.tsx`:

```tsx
const BUTTONDOWN_USERNAME = "REPLACE_WITH_REAL_BUTTONDOWN_USERNAME";

export function SubscribeForm() {
  return (
    <form
      aria-label="Subscribe to the newsletter"
      method="post"
      action={`https://buttondown.com/api/emails/embed-subscribe/${BUTTONDOWN_USERNAME}`}
      target="_blank"
      className="mt-10 flex flex-col gap-3 border-t border-line pt-8 sm:flex-row sm:items-end"
    >
      <div className="flex flex-1 flex-col gap-1.5">
        <label
          htmlFor="bd-email"
          className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted"
        >
          Get new issues by email
        </label>
        <input
          id="bd-email"
          type="email"
          name="email"
          placeholder="you@example.com"
          required
          className="border border-line bg-bg px-2.5 py-1.5 text-fg"
        />
      </div>
      <button
        type="submit"
        className="bg-accent px-2.5 py-1.5 font-semibold text-bg transition-opacity hover:opacity-85"
      >
        Subscribe
      </button>
    </form>
  );
}
```

`target="_blank"` matches Buttondown's own documented embed pattern — the confirmation page renders on Buttondown's domain, not this site's, since there's no server-side handling of the subscribe submission here.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run components/newsletter/SubscribeForm.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/newsletter/SubscribeForm.tsx app/components/newsletter/SubscribeForm.test.tsx
git commit -m "feat: add SubscribeForm (Buttondown embed)"
```

---

### Task 7: `/newsletter` and `/newsletter/[slug]` pages

**Files:**
- Create: `app/app/(site)/newsletter/page.tsx`
- Create: `app/app/(site)/newsletter/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getReader()` from Phase 2's `app/lib/keystatic-reader.ts`, `IssueList`/`IssueListItem` and `SubscribeForm` from Task 5/6, `IssueBody` from Task 5.

These two files are async Server Components (they `await` the reader) and are **not unit-tested directly** — React Testing Library cannot render an async component, and this is exactly why Tasks 5/6 exist: all the testable logic already lives in `IssueList`/`IssueBody`/`SubscribeForm`. Verified by the build succeeding (Step 3), which exercises the real reader against Task 1's real seed issue.

- [ ] **Step 1: Implement the newsletter list page**

Create `app/app/(site)/newsletter/page.tsx`:

```tsx
import { getReader } from "../../../lib/keystatic-reader";
import { IssueList } from "../../../components/newsletter/IssueList";
import { SubscribeForm } from "../../../components/newsletter/SubscribeForm";

export default async function NewsletterPage() {
  const reader = getReader();
  const issues = await reader.collections.newsletter.all();
  const sorted = [...issues].sort((a, b) =>
    (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
  );

  return (
    <section>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
        Archive
      </p>
      <h1 className="mt-4 font-mono text-3xl font-semibold tracking-tight">Newsletter</h1>
      <IssueList
        issues={sorted.map(({ slug, entry }) => ({
          slug,
          title: entry.title,
          date: entry.date ?? "",
          summary: entry.summary,
        }))}
      />
      <SubscribeForm />
    </section>
  );
}
```

- [ ] **Step 2: Implement the single-issue page**

Create `app/app/(site)/newsletter/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getReader } from "../../../../lib/keystatic-reader";
import { IssueBody } from "../../../../components/newsletter/IssueBody";

export async function generateStaticParams() {
  const reader = getReader();
  const slugs = await reader.collections.newsletter.list();
  return slugs.map((slug) => ({ slug }));
}

export default async function IssuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const reader = getReader();
  const entry = await reader.collections.newsletter.read(slug);
  if (!entry) {
    notFound();
  }
  const mdxSource = await entry.content();

  return (
    <IssueBody title={entry.title} date={entry.date ?? ""}>
      <MDXRemote source={mdxSource} />
    </IssueBody>
  );
}
```

- [ ] **Step 3: Run the full suite, lint, and build**

Run: `cd app && npm test`
Expected: PASS — no new test files in this task; existing ones (including Task 5/6's) still pass.

Run: `cd app && npm run lint && npm run build`

Build needs 4 placeholder Keystatic env vars (a pre-existing, already-diagnosed requirement from the blog phase, unrelated to this task):
`KEYSTATIC_GITHUB_CLIENT_ID=placeholder KEYSTATIC_GITHUB_CLIENT_SECRET=placeholder KEYSTATIC_SECRET=placeholder NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG=placeholder npm run build`

Expected: both succeed. The build output must show `/newsletter` and `/newsletter/hello-newsletter` (from `generateStaticParams`, using Task 1's seed issue) as statically generated routes — if `hello-newsletter` is missing, the content-path resolution is broken (re-check Task 1's collection registration).

- [ ] **Step 4: Commit**

```bash
git add "app/app/(site)/newsletter"
git commit -m "feat: add /newsletter and /newsletter/[slug] pages"
```

---

### Task 8: `/newsletter-admin` page and SendButton

**Files:**
- Create: `app/app/newsletter-admin/page.tsx`
- Create: `app/components/newsletter/SendButton.tsx`
- Create: `app/components/newsletter/SendButton.test.tsx`

**Interfaces:**
- Consumes: `getReader()`, `isIssueSent` from `app/lib/buttondown.ts` (Task 2), `SendButton` (this task).
- `SendButton` POSTs to `/api/newsletter/send` (Task 4) client-side — not a shared TypeScript interface with the route, just an HTTP contract (`{slug: string}` in, `{ok: true}` or `{error: string}` out).

`/newsletter-admin/page.tsx` is a gated async Server Component (not under the public `(site)` route group, same placement pattern as `/keystatic`) and is **not unit-tested directly** for the same reason as `/newsletter` — it's a thin, live-data-dependent wrapper. `SendButton` is a client component and *is* unit-tested (it owns the interactive/testable logic).

- [ ] **Step 1: Write the failing SendButton test**

Create `app/components/newsletter/SendButton.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SendButton } from "./SendButton";

describe("SendButton", () => {
  beforeEach(() => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  });

  it("shows Sent after a successful send", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    render(<SendButton slug="hello-newsletter" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Sent")).toBeInTheDocument());
  });

  it("shows the error message when the send fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "This issue has already been sent" }),
      }),
    );
    render(<SendButton slug="hello-newsletter" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("This issue has already been sent"),
    );
  });

  it("does not call fetch when the confirm dialog is declined", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SendButton slug="hello-newsletter" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run components/newsletter/SendButton.test.tsx`
Expected: FAIL — `Cannot find module './SendButton'`

- [ ] **Step 3: Implement SendButton**

Create `app/components/newsletter/SendButton.tsx`:

```tsx
"use client";

import { useState } from "react";

export function SendButton({ slug }: { slug: string }) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    if (!window.confirm("Send this issue to all subscribers now? This cannot be undone.")) {
      return;
    }
    setStatus("sending");
    setError(null);
    const res = await fetch("/api/newsletter/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    if (res.ok) {
      setStatus("sent");
    } else {
      setError(data.error ?? "Send failed");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted">
        Sent
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleSend}
        disabled={status === "sending"}
        className="bg-accent px-2.5 py-1.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-bg transition-opacity hover:opacity-85 disabled:opacity-50"
      >
        {status === "sending" ? "Sending…" : "Send"}
      </button>
      {status === "error" && (
        <p role="alert" className="max-w-[200px] text-right text-[0.6875rem] text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run components/newsletter/SendButton.test.tsx`
Expected: PASS

- [ ] **Step 5: Implement the admin page**

Create `app/app/newsletter-admin/page.tsx`:

```tsx
import { getReader } from "../../lib/keystatic-reader";
import { isIssueSent } from "../../lib/buttondown";
import { SendButton } from "../../components/newsletter/SendButton";

export const dynamic = "force-dynamic";

export default async function NewsletterAdminPage() {
  const reader = getReader();
  const issues = await reader.collections.newsletter.all();
  const sorted = [...issues].sort((a, b) =>
    (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
  );

  const withStatus = await Promise.all(
    sorted.map(async ({ slug, entry }) => {
      let sent: boolean | null;
      try {
        sent = await isIssueSent(slug);
      } catch {
        sent = null;
      }
      return { slug, title: entry.title, date: entry.date ?? "", sent };
    }),
  );

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <h1 className="font-mono text-3xl font-semibold tracking-tight">Newsletter Admin</h1>
      <ul className="mt-10 flex flex-col">
        {withStatus.map((issue) => (
          <li
            key={issue.slug}
            className="flex items-center justify-between gap-4 border-t border-line py-4 last:border-b"
          >
            <div>
              <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] tabular-nums text-accent">
                {issue.date}
              </p>
              <p className="mt-1 font-mono text-base font-semibold">{issue.title}</p>
            </div>
            {issue.sent === true && (
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted">
                Sent
              </span>
            )}
            {issue.sent === false && <SendButton slug={issue.slug} />}
            {issue.sent === null && (
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-red-500">
                Status unknown
              </span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

`export const dynamic = "force-dynamic"` is load-bearing, not stylistic: this page's content depends on live Buttondown state, and forcing it dynamic is also what keeps `npm run build` from ever calling Buttondown's real API during static generation — without it, the build would either fail (no `BUTTONDOWN_API_KEY` in the build environment) or bake stale sent-status into a static page.

- [ ] **Step 6: Run the full suite, lint, and build**

Run: `cd app && npm test`
Expected: PASS.

Run (with the same 4 placeholder Keystatic env vars as Task 7):
`KEYSTATIC_GITHUB_CLIENT_ID=placeholder KEYSTATIC_GITHUB_CLIENT_SECRET=placeholder KEYSTATIC_SECRET=placeholder NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG=placeholder npm run build`
Expected: succeeds. `/newsletter-admin` must appear as a dynamic (`ƒ`) route in the build output, not static (`○`) — if it's static, `dynamic = "force-dynamic"` didn't take effect and must be fixed before continuing.

Note: the build does **not** require `BUTTONDOWN_API_KEY` to be set, because `force-dynamic` means this page is never executed during the build — it only runs per-request at runtime. If the build fails here with a Buttondown-related error, that's a sign the page rendered at build time and `force-dynamic` isn't working; investigate before proceeding.

- [ ] **Step 7: Commit**

```bash
git add app/app/newsletter-admin app/components/newsletter/SendButton.tsx app/components/newsletter/SendButton.test.tsx
git commit -m "feat: add /newsletter-admin page with a manual send action"
```

---

### Task 9: Add Newsletter to site navigation

**Files:**
- Modify: `app/components/site/SiteHeader.tsx`
- Modify: `app/components/site/SiteHeader.test.tsx`

- [ ] **Step 1: Add the failing assertion**

In `app/components/site/SiteHeader.test.tsx`, add inside the existing test:

```ts
    expect(screen.getByRole("link", { name: "Newsletter" })).toHaveAttribute(
      "href",
      "/newsletter",
    );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run components/site/SiteHeader.test.tsx`
Expected: FAIL — no "Newsletter" link exists yet.

- [ ] **Step 3: Add the nav link**

In `app/components/site/SiteHeader.tsx`, change:

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
to:
```ts
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/projects", label: "Projects" },
  { href: "/resume", label: "Resume" },
  { href: "/blog", label: "Blog" },
  { href: "/newsletter", label: "Newsletter" },
  { href: "/contact", label: "Contact" },
];
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run components/site/SiteHeader.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/site/SiteHeader.tsx app/components/site/SiteHeader.test.tsx
git commit -m "feat: add Newsletter to site navigation"
```

---

### Task 10: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Read the existing format**

Run: `cat CHANGELOG.md` (or Read the file) — `## [Unreleased]` is currently empty (no subsections yet, since v1.1.0 was just released). Match the existing `### Added` style used further down the file exactly.

- [ ] **Step 2: Add the entry**

Under `## [Unreleased]`, add:

```markdown
### Added
- Newsletter archive at `/newsletter`, powered by the same Keystatic setup
  as the blog. Sending is manual: a gated admin page at `/newsletter-admin`
  triggers delivery via Buttondown once an issue is reviewed.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add changelog entry for the newsletter"
```

---

### Task 11: Full-repo verification and manual-setup handoff

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `cd app && npm test`
Expected: PASS — all tests across `lib/`, `components/newsletter/`, `components/site/`, `app/(site)/newsletter/*`, `app/api/newsletter/*` green.

- [ ] **Step 2: Run lint and build**

Run: `cd app && KEYSTATIC_GITHUB_CLIENT_ID=placeholder KEYSTATIC_GITHUB_CLIENT_SECRET=placeholder KEYSTATIC_SECRET=placeholder NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG=placeholder npm run lint && KEYSTATIC_GITHUB_CLIENT_ID=placeholder KEYSTATIC_GITHUB_CLIENT_SECRET=placeholder KEYSTATIC_SECRET=placeholder NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG=placeholder npm run build`
Expected: both succeed. Confirm the build's route table includes `/newsletter`, `/newsletter/hello-newsletter`, and `/newsletter-admin` (dynamic).

- [ ] **Step 3: Start the dev server and verify gating via curl**

Run: `cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev`

Verify without a cookie:
- `GET /newsletter` and `GET /newsletter/hello-newsletter` return 200 (public).
- `GET /newsletter-admin` redirects (307/302) to `/tools/bgm-looper/login?next=%2Fnewsletter-admin`.
- `POST /api/newsletter/send` (with any JSON body) returns `401 {"error":"unauthorized"}` — matches how `/api/keystatic/*` behaves when ungated per `middleware.ts`'s existing `/api/` branch.

Then verify the login round-trip: POST `/api/login` with the correct password, then using the returned cookie, `GET /newsletter-admin` returns 200 (not a redirect). It will show "Status unknown" for the seed issue if `BUTTONDOWN_API_KEY` isn't set in this dev session — that's expected before the manual Buttondown setup below, not a bug.

Stop the dev server when done.

- [ ] **Step 4: Report the manual setup steps to the human**

This step cannot be automated — report it as the final output of this plan, not as a commit. Tell the human:

> Code is merged. Before the newsletter can actually send anything:
> 1. Create a Buttondown account (free tier, up to 100 subscribers) at buttondown.com, if you don't have one already.
> 2. Note your Buttondown username — it's part of your account's public URL. Replace `REPLACE_WITH_REAL_BUTTONDOWN_USERNAME` in `app/components/newsletter/SubscribeForm.tsx` with it, commit that change.
> 3. Generate a Buttondown API key from your account settings.
> 4. Add `BUTTONDOWN_API_KEY` to Vercel's environment variables (dashboard, not Terraform — same convention as the 4 Keystatic vars, avoids a written-down secret in tracked files): https://vercel.com/ashutosh-pandeys-projects-77cb3a00/bgm-looper/settings/environment-variables. Add it to at least Preview; add to Production before this reaches `main` (same lesson as the blog phase's Keystatic vars — Production is a separate Vercel scope from Preview).
> 5. Visit `/newsletter-admin` on the deployed site (behind the password) and confirm the seed issue shows "Send" rather than "Status unknown," confirming the API key and connectivity are correct. Sending it for real is optional and up to you — it will email every current Buttondown subscriber.

If any bug is found during Steps 1–3, fix it, re-run the relevant test, and commit with message `fix: <description>`. If everything passes, no commit is needed for this task beyond that report.
