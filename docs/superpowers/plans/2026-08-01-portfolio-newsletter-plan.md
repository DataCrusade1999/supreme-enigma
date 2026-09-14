# Portfolio Newsletter (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revised 2026-09-14.** The original plan was written before the `/tools` hub
> and its `TOOLS` registry in `app/lib/route-gate.ts`, before the editorial
> redesign (`PageMasthead`, `font-display`, the 12-column row rhythm), and
> before the Playwright suite became half of CI's `test` gate. Every Buttondown
> API claim below was re-verified against the live OpenAPI spec on that date;
> one of them was wrong and is corrected in Global Constraints.

**Goal:** Add a newsletter to the portfolio site — a public archive of past issues (`/newsletter`, Keystatic-managed, same pattern as the blog) plus a Buttondown subscribe embed and a gated admin page that sends an issue via Buttondown's API on manual confirmation.

**Architecture:** A new `newsletter` Keystatic collection alongside the existing `blog` collection, reusing the same repo-rooted reader. A new `app/lib/buttondown.ts` module is the only code that talks to Buttondown's REST API (list-and-filter for "already sent" lookups, since Buttondown has no server-side slug filter; create-and-send for the actual send). A gated `/tools/newsletter-admin` page and `/api/newsletter/send` route provide the manual send trigger — the API route re-reads content fresh and re-checks sent-status immediately before sending, so nothing but a deliberate click ever emails subscribers.

**Tech Stack:** No new npm dependency — Buttondown's API is a plain REST/JSON API called via the runtime's built-in `fetch`.

Every Buttondown API detail in this plan was verified against Buttondown's public OpenAPI spec (`github.com/buttondown/openapi`, `openapi.json`), re-checked 2026-09-14. Confirmed on that date: base URL `https://api.buttondown.com/v1`; `Authorization: Token <key>` (the only declared security scheme); `2026-04-01` is the newest `X-API-Version`; `EmailInput` accepts a client-set `slug` (`^[a-zA-Z0-9_-]+$`, max 100 chars); `about_to_send` is a real `EmailStatus` value; `GET /v1/emails` has **no** `slug` query parameter; its response is `{results, next, previous, count}`; and the free tier still covers the first 100 subscribers.

## Global Constraints

- Total AWS spend must stay under 200 INR/month. This plan touches no AWS resource — Buttondown's free tier and this app's own Next.js routes on Vercel, both already in use.
- No new npm dependency — Buttondown is called via the runtime's built-in `fetch`, no SDK.
- The admin page lives at `/tools/newsletter-admin` and is registered in the `TOOLS` array in `app/lib/route-gate.ts`. `GATED_PREFIXES` already covers the whole `/tools` namespace, so it is behind the password by placement; only `/api/newsletter` is a new prefix. `TOOLS` is the single registry the `/tools` hub, the login page's "Continuing to → X" strip and `e2e/tools.spec.ts` all read. No new auth mechanism — the same shared-password cookie, enforced in `app/proxy.ts` (Next 16's rename of `middleware.ts`).
- New components match the editorial design language already in the repo, not a parallel one: `font-display` for headings (never `font-mono`), `text-muted` / `text-fg/80` for body copy, `border-line` / `border-rule-heavy` for rules, `text-peak` for error text, and the 12-column row rhythm `BlogList` uses. `/newsletter` opens with `PageMasthead`, like every other page. Mirror `BlogList`/`PostBody` and the login page's input/button classes rather than inventing styles.
- CI's `test` job runs Vitest **and** Playwright, and fails if either fails. Any new public page has to be added to `e2e/pages.spec.ts` and `e2e/a11y.spec.ts`, and any new `TOOLS` entry is asserted by `e2e/tools.spec.ts` — Task 10 covers this.
- Newsletter content lives at `<repo-root>/content/newsletter/*.mdx` — same repo-root-relative mechanism as `content/blog/*.mdx`, for the same reason (Keystatic GitHub-mode API paths are repo-root-relative; Vercel's `root_directory = "app"` makes this app's own `process.cwd()` be `app/`). The existing `getReader()` in `app/lib/keystatic-reader.ts` already handles this for any collection registered in `keystatic.config.ts` — no changes needed there.
- `BUTTONDOWN_API_KEY` is server-only (no `NEXT_PUBLIC_` prefix), read only inside `app/lib/buttondown.ts`, and that module throws immediately if it's unset rather than silently no-op-ing.
- Every Buttondown API call sends `Authorization: Token <key>` (verified auth scheme) and `X-API-Version: 2026-04-01` (the newest published version, pinned so a future default shift can't change behaviour underneath this code).

  **Corrected 2026-09-14 — the earlier rationale here was wrong.** This plan previously claimed that version opts into a safer default where `status` defaults to `draft`. It does not, as far as the published schema shows: `EmailInput.status` carries `"default": "about_to_send"`, i.e. **a create call that omits `status` sends to every subscriber.** Nothing in the code below depends on the old claim — `sendIssue` sets `status` explicitly and is the only function that creates an email — but the constraint is now the opposite one, and it is load-bearing: never add a `POST /v1/emails` call anywhere that leaves `status` unset. `sendIssue` also sends `X-Buttondown-Live-Dangerously: true` unconditionally, rather than relying on Buttondown's "confirmed once per API key" carve-out.

  `POST /v1/emails/{id}/publish` exists and would allow a two-step create-draft-then-publish flow, which is arguably a safer shape. It is deliberately **not** used: its only documentation is the string "Publish an email", it takes a required `EmailUpdateInput` body whose semantics for this use aren't specified, and guessing at them trades a verified one-call path for an unverified two-call one. Noted in the spec's out-of-scope list as a future option, not adopted here.
- `GET /v1/emails` has **no** server-side `slug` filter parameter (verified against the real OpenAPI schema — do not add one). "Already sent" lookups list emails and filter by `slug` client-side, following the response's `next` field until it's `null`.
- Relative imports (not the `@/*` alias) for anything covered by a Vitest test, per existing repo convention.
- Every commit message ends with the `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>` trailer this repo now requires; the commit snippets below omit it for brevity. The implementation PR targets `dev` and closes issue #29 ("Portfolio Site — Phase 3: Newsletter"), which already exists — do not file a new one.
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
from `/tools/newsletter-admin` once you're ready.
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
- Produces: `isIssueSent(slug: string): Promise<boolean>` and `sendIssue({slug, subject, body}: {slug: string; subject: string; body: string}): Promise<void>` — Task 4's API route imports both, not any lower-level Buttondown detail.
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
  // Every email, not `?status=sent`. A just-triggered send sits in
  // `about_to_send`, `throttled` or `in_flight` for a while before it becomes
  // `sent`, so filtering on `sent` would report an in-flight issue as unsent
  // and let a second click send it twice — the exact failure this guard exists
  // to prevent. Any email carrying the slug counts, whatever state it's in.
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

### Task 3: Register the newsletter admin as a tool and gate `/api/newsletter/*`

**Files:**
- Modify: `app/lib/route-gate.ts`
- Modify: `app/lib/route-gate.test.ts`

**Interfaces:**
- Consumes: `isGatedPath(pathname: string): boolean` — unchanged signature.
- Produces: a fourth `TOOLS` entry, `/tools/newsletter-admin`. Task 8 creates the page at that href; the `/tools` hub, the login page's "Continuing to → X" strip and `e2e/tools.spec.ts` (Task 10) all read the entry, so adding it here is what makes the tool visible everywhere at once.

The admin page is `/tools/newsletter-admin`, not a top-level `/newsletter-admin`. `GATED_PREFIXES` covers the whole `/tools` namespace precisely so a page added there is behind the password before anyone remembers to list it — putting the admin outside that namespace would mean a page whose gating depends on a separate list entry staying correct. The API prefixes stay explicit because `/api/` also holds ungated routes, so `/api/newsletter` is the only new prefix this task adds.

- [ ] **Step 1: Add the failing test cases**

In `app/lib/route-gate.test.ts`, add these cases to the existing `isGatedPath` `it.each` table (keep all existing cases):

```ts
    ["/api/newsletter", true],
    ["/api/newsletter/send", true],
    // Gated by the /tools prefix rather than an entry of its own — this case
    // is here to pin that, so moving the admin out of /tools fails loudly.
    ["/tools/newsletter-admin", true],
    // The public archive stays public, like /blog.
    ["/newsletter", false],
    ["/newsletter/hello-newsletter", false],
```

And add a case to the existing `toolNameFor` table:

```ts
    ["/tools/newsletter-admin", "Newsletter admin"],
```

- [ ] **Step 2: Run it to verify the new cases fail**

Run: `cd app && npx vitest run lib/route-gate.test.ts`
Expected: FAIL — the two `/api/newsletter*` cases return `false` (no such prefix yet) and `toolNameFor("/tools/newsletter-admin")` returns `null` (no such `TOOLS` entry yet). The `/tools/newsletter-admin` gating case and both public cases pass already; that is the point of them.

- [ ] **Step 3: Add the TOOLS entry**

In `app/lib/route-gate.ts`, add a new entry to `TOOLS` — the fourth — between `Resume admin` and `Content editor` (the array's order is the hub's display order):

```ts
  {
    href: "/tools/newsletter-admin",
    name: "Newsletter admin",
    kind: "Site",
    blurb:
      "Review an archived newsletter issue and send it to subscribers through Buttondown.",
  },
```

- [ ] **Step 4: Widen the Content editor blurb**

Still in `app/lib/route-gate.ts`, the existing `Content editor` entry says it edits blog posts; Task 1 gives it a second collection. Change:

```ts
    blurb: "Write and edit blog posts. Commits straight to the repo through Keystatic.",
```
to:
```ts
    blurb:
      "Write and edit blog posts and newsletter issues. Commits straight to the repo through Keystatic.",
```

- [ ] **Step 5: Add the API prefix**

In `app/lib/route-gate.ts`, add `"/api/newsletter"` to `GATED_PREFIXES`:

```ts
const GATED_PREFIXES = [
  "/tools",
  "/api/looper",
  "/api/resume",
  "/api/newsletter",
  "/keystatic",
  "/api/keystatic",
];
```

Note what is *not* changed: no `/tools/newsletter-admin` entry is added here. The `/tools` prefix already matches it, and a duplicate would suggest the namespace rule doesn't hold.

- [ ] **Step 6: Run it to verify it passes**

Run: `cd app && npx vitest run lib/route-gate.test.ts`
Expected: PASS — all cases (old and new) green, including the existing `TOOLS.forEach` test that asserts every listed tool's href is gated.

- [ ] **Step 7: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/lib/route-gate.ts app/lib/route-gate.test.ts
git commit -m "feat: register the newsletter admin as a tool and gate /api/newsletter/*"
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
- Produces: `IssueBody({title, date, rail, children}: {title: string; date: string; rail?: React.ReactNode; children: React.ReactNode})` — takes `children` rather than an MDX source string, so `next-mdx-remote/rsc`'s `<MDXRemote>` (untestable under Vitest) is never imported inside a tested component — Task 7's `/newsletter/[slug]` page passes `<MDXRemote source={mdxSource} />` as `IssueBody`'s `children` and an `<IssueRail />` element as `rail`.
- The `rail` subtree itself is `IssueRail`, built in Task 6 — it renders `SubscribeForm`, so it cannot be built before that component exists.

**Why `IssueBody` owns the grid.** The design settled on a counterweight rail: the reading column sits in columns 1–6 and a rail in columns 9–12 carries the send date, the newer/older issues and the subscribe form. Without it, a 576px measure on a 1440px page leaves the right two-thirds empty and the whitespace reads as accidental rather than composed. `IssueBody` declares the `grid grid-cols-12 gap-6` wrapper itself rather than leaving it to `page.tsx`, so the layout stays inside a component with a test; the page stays thin and just supplies the two subtrees.

**This deliberately splits `/newsletter/[slug]` from `/blog/[slug]`,** which §7 of the spec had made identical on purpose. The split is the decision, not an oversight: a newsletter has between-issue navigation and a standing subscribe call, and a blog handles both through tags and its list page. `/blog/[slug]` keeps its narrow single column and its empty right two-thirds — changing that is out of scope here and should be its own issue if it is ever wanted.

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
    <ul className="mt-10">
      {issues.map((issue) => (
        // Same row rhythm as /blog and /projects: the title's Link stretches
        // over the whole row with `after:inset-0`, so the accessible name stays
        // the issue title rather than swallowing the summary.
        <li key={issue.slug} className="group relative border-b border-line">
          <span
            aria-hidden="true"
            className="absolute inset-0 origin-left scale-x-0 bg-accent/10 transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
          />
          <div className="relative grid grid-cols-12 gap-6 py-7 transition-[padding] duration-200 ease-out group-hover:pl-3 motion-reduce:transition-none">
            <p className="col-span-12 text-xs uppercase tracking-[0.14em] tabular-nums text-accent md:col-span-2">
              {issue.date}
            </p>

            {/* Spans to column 12 rather than stopping at 9 like BlogList's
              * rows — there is no tag column to leave room for. */}
            <div className="col-span-12 md:col-span-10 md:col-start-3">
              <h2 className="font-display text-3xl leading-tight md:text-[2rem]">
                <Link
                  href={`/newsletter/${issue.slug}`}
                  className="after:absolute after:inset-0 after:content-['']"
                >
                  {issue.title}
                </Link>
              </h2>
              <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-muted">
                {issue.summary}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

This is `BlogList` with the tag column removed — same hover wash, same 12-column
grid, same stretched-link trick. If that file and this snippet have drifted by
the time you read it, copy `app/components/blog/BlogList.tsx`: it is the source
of truth for the row rhythm, not this plan.

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

  it("renders the rail beside the body when one is passed", () => {
    render(
      <IssueBody
        title="Hello, newsletter"
        date="2026-08-01"
        rail={<p>Rail content</p>}
      >
        <p>This is the body.</p>
      </IssueBody>,
    );
    expect(screen.getByText("Rail content")).toBeInTheDocument();
  });

  // `rail` is optional so the component still renders for an issue whose
  // neighbours and date are all absent — the body must never depend on it.
  it("renders without a rail", () => {
    render(
      <IssueBody title="Hello, newsletter" date="2026-08-01">
        <p>This is the body.</p>
      </IssueBody>,
    );
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
  rail,
  children,
}: {
  title: string;
  date: string;
  rail?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Reading column. The measure is still capped at max-w-xl (576px) — that
        * is the right length for 15px text, and widening it to fill the page
        * would make the issue harder to read, not easier. What changed is that
        * the column is no longer the only thing on the page. */}
      <article className="col-span-12 lg:col-span-6">
        <p className="text-[0.6875rem] uppercase tracking-[0.16em] tabular-nums text-accent">
          {date}
        </p>
        <h1 className="mt-4 font-display text-4xl leading-tight sm:text-5xl">{title}</h1>
        <div className="mt-10 flex max-w-xl flex-col gap-4 text-[0.9375rem] leading-relaxed text-fg/80">
          {children}
        </div>
      </article>

      {/* Counterweight. Stacks under the body below lg, where there is no spare
        * width to counterweight and the rail is simply the page's tail. */}
      {rail ? (
        <div className="col-span-12 mt-12 lg:col-span-4 lg:col-start-9 lg:mt-0">{rail}</div>
      ) : null}
    </div>
  );
}
```

The `<article>` inside is the old `IssueBody` unchanged, and still matches
`app/components/blog/PostBody.tsx` line for line — the reading experience is the
same, the page around it is not. This file imports nothing from
`next-mdx-remote` — per the Global Constraints, that stays confined to Task 7's
untested async `page.tsx`.

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

### Task 6: SubscribeForm and IssueRail

**Files:**
- Create: `app/components/newsletter/SubscribeForm.tsx`
- Create: `app/components/newsletter/SubscribeForm.test.tsx`
- Create: `app/components/newsletter/IssueRail.tsx`
- Create: `app/components/newsletter/IssueRail.test.tsx`

**Interfaces:**
- Produces: `SubscribeForm({variant = "page"}: {variant?: "page" | "rail"})` — `"page"` is the full-width form the `/newsletter` archive renders; `"rail"` is the same form stacked into a narrow column. One component with two spacings, not two components: the `action` URL and the Buttondown username must not exist in two places.
- Produces: `IssueNeighbour` type (`{slug, title, date}`) and `IssueRail({sentDate, newer, older}: {sentDate: string; newer: IssueNeighbour | null; older: IssueNeighbour | null})` — Task 5's `IssueBody` takes this as its `rail` prop and Task 7 derives `newer`/`older` from the sorted collection.

`IssueRail` lives here rather than in Task 5 because it renders `SubscribeForm`: building it earlier would mean importing a module that does not exist yet.

The Buttondown username used in the form's `action` URL is a constant in this file, not an env var — it's public information (it's part of a public URL), consistent with treating it as configuration baked in at the point of use rather than secret. Update `BUTTONDOWN_USERNAME` below once the real Buttondown account exists (Task 12 documents this as part of the manual handoff).

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

  // The rail variant is the same form in a narrower column — same action, same
  // labelled input, same button. Only the spacing differs, which is why this is
  // one component with a prop rather than two components that can drift apart.
  it("renders the same form in the rail variant", () => {
    render(<SubscribeForm variant="rail" />);
    const form = screen.getByRole("form", { name: "Subscribe to the newsletter" });
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

export function SubscribeForm({
  variant = "page",
}: {
  variant?: "page" | "rail";
}) {
  const isRail = variant === "rail";

  return (
    <form
      aria-label="Subscribe to the newsletter"
      method="post"
      action={`https://buttondown.com/api/emails/embed-subscribe/${BUTTONDOWN_USERNAME}`}
      target="_blank"
      className={
        isRail
          ? "mt-6 flex flex-col gap-3.5 border-t border-line pt-5"
          : "mt-12 flex flex-col gap-3.5 border-t-2 border-rule-heavy pt-8"
      }
    >
      <label
        htmlFor="bd-email"
        className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted"
      >
        Get new issues by email
      </label>
      {/* Side by side at page width, stacked in the rail — a 44px-tall field and
        * a 44px-tall button will not both fit across four columns. */}
      <div className={isRail ? "flex flex-col gap-3" : "flex items-stretch gap-3"}>
        <input
          id="bd-email"
          type="email"
          name="email"
          placeholder="you@example.com"
          required
          className={
            isRail
              ? "min-h-11 w-full border border-line px-3 text-sm text-fg placeholder:text-muted"
              : "min-h-11 w-full max-w-80 border border-line px-3 text-sm text-fg placeholder:text-muted"
          }
        />
        <button
          type="submit"
          className="min-h-11 shrink-0 bg-fg px-5 text-sm font-semibold tracking-tight text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
        >
          Subscribe
        </button>
      </div>
    </form>
  );
}
```

The input and button copy the login page's field and submit-button classes
(`app/app/login/page.tsx`) — the only other place on this site that asks a
visitor to type something — including the 44px minimum hit target those carry.

`target="_blank"` matches Buttondown's own documented embed pattern — the confirmation page renders on Buttondown's domain, not this site's, since there's no server-side handling of the subscribe submission here.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run components/newsletter/SubscribeForm.test.tsx`
Expected: PASS — both variants.

- [ ] **Step 5: Write the failing IssueRail test**

Create `app/components/newsletter/IssueRail.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssueRail } from "./IssueRail";

const NEWER = { slug: "three-buckets", title: "Three branches, three buckets", date: "2026-09-12" };
const OLDER = { slug: "hello-newsletter", title: "Hello, newsletter", date: "2026-08-01" };

describe("IssueRail", () => {
  it("names the send date and links both neighbours", () => {
    render(<IssueRail sentDate="2026-08-24" newer={NEWER} older={OLDER} />);
    expect(screen.getByText("2026-08-24")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Three branches, three buckets" }),
    ).toHaveAttribute("href", "/newsletter/three-buckets");
    expect(screen.getByRole("link", { name: "Hello, newsletter" })).toHaveAttribute(
      "href",
      "/newsletter/hello-newsletter",
    );
  });

  // The newest issue has no newer neighbour and the oldest has no older one —
  // an absent slot must render nothing, not a dead link.
  it("omits a neighbour that does not exist", () => {
    render(<IssueRail sentDate="2026-09-12" newer={null} older={OLDER} />);
    expect(screen.queryByText(/Newer/)).not.toBeInTheDocument();
    expect(screen.getByText(/Older/)).toBeInTheDocument();
  });

  // The seed issue is the only issue. The rail still has a job (the send date
  // and the subscribe form); only the navigation block disappears.
  it("renders with no neighbours at all", () => {
    render(<IssueRail sentDate="2026-08-01" newer={null} older={null} />);
    expect(screen.getByText("2026-08-01")).toBeInTheDocument();
    expect(screen.queryByText("More issues")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd app && npx vitest run components/newsletter/IssueRail.test.tsx`
Expected: FAIL — `Cannot find module './IssueRail'`

- [ ] **Step 7: Implement IssueRail**

Create `app/components/newsletter/IssueRail.tsx`:

```tsx
import Link from "next/link";
import { SubscribeForm } from "./SubscribeForm";

export type IssueNeighbour = {
  slug: string;
  title: string;
  date: string;
};

export function IssueRail({
  sentDate,
  newer,
  older,
}: {
  sentDate: string;
  newer: IssueNeighbour | null;
  older: IssueNeighbour | null;
}) {
  const neighbours = [
    { label: "Newer", issue: newer },
    { label: "Older", issue: older },
  ].filter((entry): entry is { label: string; issue: IssueNeighbour } =>
    entry.issue !== null,
  );

  return (
    <div>
      {/* No issue number here, deliberately. The content schema is
        * title/date/summary/content and nothing else, and deriving a number
        * from position in the sorted list would renumber every issue the
        * moment one was deleted. The send date is a real field, and it is the
        * fact a reader wants in this slot: this was an email before it was a
        * page. */}
      <div className="border-t-2 border-rule-heavy pt-5">
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          Emailed to subscribers on{" "}
          <span className="tabular-nums text-fg">{sentDate}</span>, and archived
          here the same day.
        </p>
      </div>

      {neighbours.length > 0 && (
        <div className="mt-8 border-t border-line pt-5">
          <p className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
            More issues
          </p>
          <ul className="mt-4">
            {neighbours.map(({ label, issue }) => (
              <li key={issue.slug} className="border-b border-line py-3.5">
                <p className="text-[0.6875rem] uppercase tracking-[0.14em] tabular-nums text-accent">
                  {issue.date} · {label}
                </p>
                <Link
                  href={`/newsletter/${issue.slug}`}
                  className="mt-1.5 block font-display text-xl leading-tight"
                >
                  {issue.title}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href="/newsletter"
            className="mt-4 inline-flex min-h-11 items-center text-[0.6875rem] uppercase tracking-[0.16em] text-muted transition-colors duration-200 ease-out hover:text-fg motion-reduce:transition-none"
          >
            <span className="border-b border-accent pb-0.5">All issues →</span>
          </Link>
        </div>
      )}

      <SubscribeForm variant="rail" />
    </div>
  );
}
```

The rail reuses `SubscribeForm` rather than copying the form: the `action` URL
and the Buttondown username must exist in exactly one file, or a username change
after the manual setup step (Task 12) will fix one of them and miss the other.

- [ ] **Step 8: Run it to verify it passes**

Run: `cd app && npx vitest run components/newsletter/`
Expected: PASS — `IssueList`, `IssueBody`, `SubscribeForm` and `IssueRail` all green.

- [ ] **Step 9: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add app/components/newsletter/SubscribeForm.tsx app/components/newsletter/SubscribeForm.test.tsx app/components/newsletter/IssueRail.tsx app/components/newsletter/IssueRail.test.tsx
git commit -m "feat: add SubscribeForm (Buttondown embed) and the issue rail"
```

---

### Task 7: `/newsletter` and `/newsletter/[slug]` pages

**Files:**
- Create: `app/app/(site)/newsletter/page.tsx`
- Create: `app/app/(site)/newsletter/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getReader()` from Phase 2's `app/lib/keystatic-reader.ts`, `IssueList`/`IssueListItem` and `IssueBody` from Task 5, `SubscribeForm` and `IssueRail`/`IssueNeighbour` from Task 6.

**`/newsletter/[slug]` reads the whole collection, not one entry.** The rail names the newer and older issues, which cannot be answered from `read(slug)` alone — the page sorts every entry by date descending, finds this slug's position, and takes the entries either side. `read(slug)` still supplies the body: `all()` is used for the ordering and the neighbours' titles and dates only, so the page never depends on whether `all()`'s entries expose `content()` on the installed reader version. For an archive of this size the extra read costs nothing, and both calls are resolved at build time by `generateStaticParams` anyway.

These two files are async Server Components (they `await` the reader) and are **not unit-tested directly** — React Testing Library cannot render an async component, and this is exactly why Tasks 5/6 exist: all the testable logic already lives in `IssueList`/`IssueBody`/`SubscribeForm`. Verified by the build succeeding (Step 3), which exercises the real reader against Task 1's real seed issue.

- [ ] **Step 1: Implement the newsletter list page**

Create `app/app/(site)/newsletter/page.tsx`:

```tsx
import { getReader } from "../../../lib/keystatic-reader";
import { IssueList } from "../../../components/newsletter/IssueList";
import { SubscribeForm } from "../../../components/newsletter/SubscribeForm";
import { PageMasthead } from "../../../components/site/PageMasthead";

export default async function NewsletterPage() {
  const reader = getReader();
  const issues = await reader.collections.newsletter.all();
  const sorted = [...issues].sort((a, b) =>
    (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
  );

  return (
    <section>
      {/* Every page opens with this component and its title is the page's h1 —
        * app/app/(site)/blog/page.tsx is the pattern this mirrors. */}
      <PageMasthead eyebrow="Writing" title="Newsletter" />
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
import {
  IssueRail,
  type IssueNeighbour,
} from "../../../../components/newsletter/IssueRail";

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

  // Same sort as /newsletter, so "newer" and "older" mean what the archive's
  // ordering says they mean. An issue with no date sorts last under `?? ""`,
  // which is the same fallback the list page uses.
  const all = await reader.collections.newsletter.all();
  const sorted = [...all].sort((a, b) =>
    (b.entry.date ?? "").localeCompare(a.entry.date ?? ""),
  );
  const index = sorted.findIndex((candidate) => candidate.slug === slug);

  // index - 1 is the newer issue because the list is descending. A -1 index
  // (the slug is somehow absent from all()) leaves both neighbours null rather
  // than reading off the end of the array.
  const neighbourAt = (position: number): IssueNeighbour | null => {
    if (index < 0) return null;
    const found = sorted[position];
    return found
      ? { slug: found.slug, title: found.entry.title, date: found.entry.date ?? "" }
      : null;
  };

  return (
    <IssueBody
      title={entry.title}
      date={entry.date ?? ""}
      rail={
        <IssueRail
          sentDate={entry.date ?? ""}
          newer={neighbourAt(index - 1)}
          older={neighbourAt(index + 1)}
        />
      }
    >
      <MDXRemote source={mdxSource} />
    </IssueBody>
  );
}
```

Note the page no longer renders `SubscribeForm` on this route — `IssueRail` owns
it here. `/newsletter` still renders it directly at page width.

- [ ] **Step 3: Run the full suite, lint, and build**

Run: `cd app && npm test`
Expected: PASS — no new test files in this task; existing ones (including Task 5/6's) still pass.

Run: `cd app && npm run lint && npm run build`

Build needs three placeholder Keystatic env vars (a pre-existing, already-diagnosed requirement from the blog phase, unrelated to this task — `NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG` was a fourth when this plan was written and is no longer referenced anywhere in `app/`):
`KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build`

Expected: both succeed. The build output must show `/newsletter` and `/newsletter/hello-newsletter` (from `generateStaticParams`, using Task 1's seed issue) as statically generated routes — if `hello-newsletter` is missing, the content-path resolution is broken (re-check Task 1's collection registration).

With only the seed issue in the collection, the rail's "More issues" block is absent by design (no neighbours) and the send date plus the subscribe form are all it shows. That is the correct rendering, not a bug — Task 6's third `IssueRail` test pins it. To see the block, add a second `.mdx` file under `content/newsletter/` locally and delete it before committing.

- [ ] **Step 4: Commit**

```bash
git add "app/app/(site)/newsletter"
git commit -m "feat: add /newsletter and /newsletter/[slug] pages"
```

---

### Task 8: `/tools/newsletter-admin` page and SendButton

**Files:**
- Create: `app/app/tools/newsletter-admin/page.tsx`
- Create: `app/components/newsletter/SendButton.tsx`
- Create: `app/components/newsletter/SendButton.test.tsx`

**Interfaces:**
- Consumes: `getReader()`, `isIssueSent` from `app/lib/buttondown.ts` (Task 2), `SendButton` (this task), and the `TOOLS` entry registered in Task 3 — the hub links here by that href.
- `SendButton` POSTs to `/api/newsletter/send` (Task 4) client-side — not a shared TypeScript interface with the route, just an HTTP contract (`{slug: string}` in, `{ok: true}` or `{error: string}` out).

`app/app/tools/newsletter-admin/page.tsx` is a gated async Server Component — gated by living under `/tools`, which `GATED_PREFIXES` covers wholesale — and sits outside the public `(site)` route group, so it gets no `SiteHeader`. It is **not unit-tested directly** for the same reason as `/newsletter`: a thin, live-data-dependent wrapper. `SendButton` is a client component and *is* unit-tested (it owns the interactive/testable logic).

The page's chrome copies `app/app/tools/resume-admin/page.tsx` — the same slim header (wordmark on the left, `Tools / <name>` on the right, `border-b-2 border-rule-heavy`), the same `grid-cols-12` main, and the same trailing `<CommandBar />`. Read that file before writing this one; the two tools should be indistinguishable in layout.

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
      <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
        Sent
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleSend}
        disabled={status === "sending"}
        className="min-h-11 shrink-0 bg-fg px-5 text-sm font-semibold tracking-tight text-bg transition-colors duration-200 ease-out hover:bg-accent disabled:opacity-50 motion-reduce:transition-none"
      >
        {status === "sending" ? "Sending…" : "Send"}
      </button>
      {status === "error" && (
        <p role="alert" className="max-w-[220px] text-right text-[0.8125rem] text-peak">
          {error}
        </p>
      )}
    </div>
  );
}
```

The button is the login page's submit button; `text-peak` is the error colour
this repo already uses (see the login page and `resume-admin`), not `text-red-500`
— the palette is token-driven and a raw Tailwind colour would miss the theme.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd app && npx vitest run components/newsletter/SendButton.test.tsx`
Expected: PASS

- [ ] **Step 5: Implement the admin page**

Create `app/app/tools/newsletter-admin/page.tsx`:

```tsx
import Link from "next/link";
import { getReader } from "../../../lib/keystatic-reader";
import { isIssueSent } from "../../../lib/buttondown";
import { CommandBar } from "../../../components/site/CommandBar";
import { SendButton } from "../../../components/newsletter/SendButton";

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
    <div className="flex min-h-screen flex-col font-ui">
      {/* Same slim header as /tools/resume-admin — the tool pages sit outside
        * the (site) route group, so there is no SiteHeader above them. */}
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg"
        >
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Ashutosh Pandey
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
          Tools / Newsletter admin
        </span>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-6 px-5 py-14 sm:px-10">
        <div className="col-span-12 lg:col-span-8">
          <h1 className="font-display text-3xl leading-[1.15]">Send an issue</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Every archived issue, newest first. Sending emails every current
            Buttondown subscriber and cannot be undone.
          </p>

          <ul className="mt-10">
            {withStatus.map((issue) => (
              <li
                key={issue.slug}
                className="flex items-center justify-between gap-6 border-b border-line py-5"
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] tabular-nums text-accent">
                    {issue.date}
                  </p>
                  <p className="mt-1 font-display text-xl leading-tight">{issue.title}</p>
                </div>
                {issue.sent === true && (
                  <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
                    Sent
                  </span>
                )}
                {issue.sent === false && <SendButton slug={issue.slug} />}
                {issue.sent === null && (
                  <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-peak">
                    Status unknown
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </main>

      {/* Not decoration: /tools/* pages render outside the (site) route group
        * and so have no SiteHeader — ⌘K is the only nav they carry. Every other
        * tool page mounts it the same way. It is a client component rendered
        * from a Server Component, which is fine and deliberate. */}
      <CommandBar />
    </div>
  );
}
```

`export const dynamic = "force-dynamic"` is load-bearing, not stylistic: this page's content depends on live Buttondown state, and forcing it dynamic is also what keeps `npm run build` from ever calling Buttondown's real API during static generation — without it, the build would either fail (no `BUTTONDOWN_API_KEY` in the build environment) or bake stale sent-status into a static page.

- [ ] **Step 6: Run the full suite, lint, and build**

Run: `cd app && npm test`
Expected: PASS.

Run (with the same three placeholder Keystatic env vars as Task 7):
`KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build`
Expected: succeeds. `/tools/newsletter-admin` must appear as a dynamic (`ƒ`) route in the build output, not static (`○`) — if it's static, `dynamic = "force-dynamic"` didn't take effect and must be fixed before continuing.

Note: the build does **not** require `BUTTONDOWN_API_KEY` to be set, because `force-dynamic` means this page is never executed during the build — it only runs per-request at runtime. If the build fails here with a Buttondown-related error, that's a sign the page rendered at build time and `force-dynamic` isn't working; investigate before proceeding.

- [ ] **Step 7: Commit**

```bash
git add app/app/tools/newsletter-admin app/components/newsletter/SendButton.tsx app/components/newsletter/SendButton.test.tsx
git commit -m "feat: add /tools/newsletter-admin with a manual send action"
```

---

### Task 9: Add Newsletter to the site nav and the command bar

**Files:**
- Modify: `app/components/site/SiteHeader.tsx`
- Modify: `app/components/site/SiteHeader.test.tsx`
- Modify: `app/lib/site/commands.ts`
- Modify: `app/lib/site/commands.test.ts`

Two separate navigation surfaces, and neither is derived from the other.
`SiteHeader`'s `NAV_LINKS` is the public nav; `COMMANDS` in `app/lib/site/commands.ts`
is the ⌘K command bar, which is deliberately hand-written rather than generated
from `TOOLS` (the label is a command someone types, and `open content-editor`
isn't derivable from `/keystatic`). A page added to one and not the other is
half-reachable, so both change here — and for `/tools/newsletter-admin` the
command bar is not a convenience but the only nav that page has.

- [ ] **Step 1: Add the failing assertions**

In `app/components/site/SiteHeader.test.tsx`, add inside the existing nav test:

```ts
    expect(screen.getByRole("link", { name: "Newsletter" })).toHaveAttribute(
      "href",
      "/newsletter",
    );
```

The command tests live in `app/lib/site/commands.test.ts`, next to the data —
not in `CommandBar.test.tsx`, which tests the dialog. Its first case asserts an
**exact, ordered** array of every command id, so this is not an additive change:
that array has to gain both new ids in the right positions or the existing test
fails. Add `"cd-newsletter"` between `"cd-blog"` and `"cd-contact"` (the `cd`
rows follow the header's nav order) and `"open-newsletter-admin"` between
`"open-resume-admin"` and `"open-content-editor"`:

```ts
    expect(COMMANDS.map((command) => command.id)).toEqual([
      "cd-home",
      "cd-about",
      "cd-projects",
      "cd-resume",
      "cd-blog",
      "cd-newsletter",
      "cd-contact",
      "cd-tools",
      "open-bgm-looper",
      "open-resume-admin",
      "open-newsletter-admin",
      "open-content-editor",
      "theme-dark",
      "theme-light",
    ]);
```

Then add a row to the existing `it.each` table that asserts each gated
destination's href — the comment above it ("every gated destination is reachable
by name, not just the one that has a header button") is exactly why the new tool
belongs there:

```ts
    ["open-newsletter-admin", "/tools/newsletter-admin"],
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && npx vitest run components/site/SiteHeader.test.tsx lib/site/commands.test.ts`
Expected: FAIL — no "Newsletter" link, and the id array doesn't match because the two new commands don't exist yet.

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

- [ ] **Step 4: Add the command bar rows**

In `app/lib/site/commands.ts`, add `cd newsletter` between the `cd-blog` and
`cd-contact` entries, matching the order pinned in Step 1:

```ts
  {
    id: "cd-newsletter",
    label: "cd newsletter",
    hint: "Read the newsletter archive",
    run: (ctx) => ctx.push("/newsletter"),
  },
```

and `open newsletter-admin` alongside the other gated tools, after
`open-resume-admin`:

```ts
  {
    id: "open-newsletter-admin",
    label: "open newsletter-admin",
    hint: "Send a newsletter issue",
    run: (ctx) => ctx.push("/tools/newsletter-admin"),
  },
```

- [ ] **Step 5: Run them to verify they pass**

Run: `cd app && npx vitest run components/site/SiteHeader.test.tsx lib/site/commands.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `cd app && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/site/SiteHeader.tsx app/components/site/SiteHeader.test.tsx app/lib/site/commands.ts app/lib/site/commands.test.ts
git commit -m "feat: add Newsletter to the site nav and the command bar"
```

---

### Task 10: End-to-end and accessibility coverage

**Files:**
- Modify: `app/e2e/pages.spec.ts`
- Modify: `app/e2e/a11y.spec.ts`
- Modify: `app/e2e/navigation.spec.ts`
- Modify: `app/e2e/tools.spec.ts`

CI's `test` job runs Vitest **and** Playwright and fails if either fails, so a
green `npm test` is only half the gate. These four specs enumerate the site's
pages and tools by hand; a new page that isn't added to them is simply untested,
and a new `TOOLS` entry may actively break `tools.spec.ts` if that spec asserts
an exact row count. Read each file before editing — the shapes below are from
2026-09-14 and the specs change.

Playwright needs a one-time `npx playwright install chromium` on a fresh machine.

- [ ] **Step 1: Add the public pages to the smoke and a11y sweeps**

In `app/e2e/pages.spec.ts`, add to the `PAGES` array:

```ts
  { path: "/newsletter", heading: "Newsletter" },
  { path: "/newsletter/hello-newsletter", heading: "Hello, newsletter" },
```

In `app/e2e/a11y.spec.ts`, add the same two paths to `PATHS`. The axe sweep is
the one check that the `SubscribeForm` label/input association and the contrast
of the new rows actually hold — Vitest asserts structure, not contrast. It also
catches the one hazard the rail introduces: `SubscribeForm` renders twice on
`/newsletter/[slug]`’s ancestors only if a page ever shows both variants at once,
and two `id="bd-email"` inputs on one page would be a duplicate-id violation.
The design does not do that — the archive renders the page variant, the issue
page renders only the rail one — and axe is what proves it stays that way.

- [ ] **Step 2: Add the nav click-through**

In `app/e2e/navigation.spec.ts`, extend the existing header-nav test after the
Blog step:

```ts
  await page.getByRole("link", { name: "Newsletter" }).click();
  await expect(page).toHaveURL("/newsletter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Newsletter" }),
  ).toBeVisible();
```

- [ ] **Step 3: Cover the new tool row**

Read `app/e2e/tools.spec.ts` and extend whatever it asserts about the hub's rows
to include `Newsletter admin` → `/tools/newsletter-admin`, mirroring the existing
`Resume admin` assertions. It also drives `open resume-admin` through the command
bar — add the `open newsletter-admin` equivalent, which lands on the page Task 8
created.

Note the page will render "Status unknown" for every issue in this run: the e2e
environment has no `BUTTONDOWN_API_KEY`, so `isIssueSent` throws and the page
falls back to the unknown state by design. Assert on the heading and the row
being present, **not** on a "Send" button existing — that would make the suite
depend on a live Buttondown account.

- [ ] **Step 4: Run the e2e suite**

Run: `cd app && npm run test:e2e`
Expected: PASS. It builds and serves the app itself, so this also catches a
build break the unit suite cannot see.

- [ ] **Step 5: Commit**

```bash
git add app/e2e
git commit -m "test: cover the newsletter pages and admin tool in the e2e suite"
```

---

### Task 11: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Read the existing format**

Run: `cat CHANGELOG.md` (or Read the file) — `## [Unreleased]` is empty as of
2026-09-14 (v1.3.1 was the last release). Match the existing `### Added` style
used further down the file exactly. If `[Unreleased]` already has an `### Added`
subsection by the time you get here, append to it rather than adding a second one.

- [ ] **Step 2: Add the entry**

Under `## [Unreleased]`, add:

```markdown
### Added
- Newsletter archive at `/newsletter`, powered by the same Keystatic setup
  as the blog. Sending is manual: the gated `/tools/newsletter-admin` tool
  triggers delivery via Buttondown once an issue is reviewed.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add changelog entry for the newsletter"
```

---

### Task 12: Full-repo verification and manual-setup handoff

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `cd app && npm test`
Expected: PASS — all tests across `lib/`, `components/newsletter/`, `components/site/` and `app/api/newsletter/*` green.

- [ ] **Step 2: Run the e2e suite**

Run: `cd app && npm run test:e2e`
Expected: PASS. This is not optional and not covered by Step 1 — CI's `test` job runs both, and a failure in either fails the job.

- [ ] **Step 3: Run lint and build**

The build needs three placeholder Keystatic env vars (a pre-existing, already-diagnosed requirement from the blog phase, unrelated to this plan — see CLAUDE.md's gotcha about `Failed to collect configuration for /api/keystatic/[...params]`):

```bash
cd app && npm run lint
cd app && KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build
```

Expected: both succeed. Confirm the build's route table includes `/newsletter` and `/newsletter/hello-newsletter` as static (`○`/`●`) and `/tools/newsletter-admin` as dynamic (`ƒ`).

- [ ] **Step 4: Start the dev server and verify gating via curl**

Run: `cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev`

Verify without a cookie:
- `GET /newsletter` and `GET /newsletter/hello-newsletter` return 200 (public).
- `GET /tools/newsletter-admin` redirects (307/302) to `/login?next=%2Ftools%2Fnewsletter-admin`.
- `POST /api/newsletter/send` (with any JSON body) returns `401 {"error":"unauthorized"}` — the `/api/` branch in `app/proxy.ts` (Next 16's rename of `middleware.ts`; the file is `app/proxy.ts`, not `app/middleware.ts`) answers with a 401 rather than a redirect.

Then verify the login round-trip: POST `/api/login` with the correct password, then using the returned cookie, `GET /tools/newsletter-admin` returns 200 (not a redirect), and `GET /tools` lists a `Newsletter admin` row. The admin page will show "Status unknown" for the seed issue if `BUTTONDOWN_API_KEY` isn't set in this dev session — that's expected before the manual Buttondown setup below, not a bug.

Stop the dev server when done.

- [ ] **Step 5: Open the PR**

Target `dev`. The PR body closes the tracking issue that already exists:

```
Closes #29
```

Then follow CLAUDE.md's "Merging a PR" sequence in full — both review bots, severity triage, thread resolution. Nothing about this phase is exempt from it.

- [ ] **Step 6: Report the manual setup steps to the human**

This step cannot be automated — report it as the final output of this plan, not as a commit. Tell the human:

> Code is merged. Before the newsletter can actually send anything:
> 1. Create a Buttondown account (free tier, first 100 subscribers, re-confirmed 2026-09-14) at buttondown.com, if you don't have one already.
> 2. Note your Buttondown username — it's part of your account's public URL. Replace `REPLACE_WITH_REAL_BUTTONDOWN_USERNAME` in `app/components/newsletter/SubscribeForm.tsx` with it, commit that change.
> 3. Generate a Buttondown API key from your account settings.
> 4. Add `BUTTONDOWN_API_KEY` to Vercel's environment variables (dashboard, not Terraform — same convention as the Keystatic vars, avoids a written-down secret in tracked files): https://vercel.com/ashutosh-pandeys-projects-77cb3a00/bgm-looper/settings/environment-variables. Add it to at least Preview; add to Production before this reaches `main` (same lesson as the blog phase's Keystatic vars — Production is a separate Vercel scope from Preview).
> 5. Visit `/tools/newsletter-admin` on the deployed site (behind the password) and confirm the seed issue shows "Send" rather than "Status unknown," confirming the API key and connectivity are correct. Sending it for real is optional and up to you — it will email every current Buttondown subscriber, and there is no undo.

If any bug is found during Steps 1–4, fix it, re-run the relevant test, and commit with message `fix: <description>`. If everything passes, no commit is needed for this task beyond that report.
