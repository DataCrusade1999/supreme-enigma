# Resume Pipeline Phase 2 — Admin Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the owner-only pipeline that takes a resume PDF from upload, through model extraction and human review, to a published `resume/current.{pdf,json}` in S3.

**Architecture:** A zod schema is the single source of truth for the model's output contract, the review-step validation, and (in Phase 3) the page props. Four API routes under `/api/resume` do the work — presign an upload, extract via OpenRouter, save a corrected draft, publish — and a gated admin page at `/tools/resume-admin` drives them. Drafts are writable from every branch so a draft reviewed on `dev` can be published from production without redoing anything; only the publish route is production-only.

**Tech Stack:** Next.js 16.3.4 (App Router, route handlers), React 19, TypeScript, zod 4, AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-resume-pipeline-design.md`

**Prerequisite:** Phase 1 (`docs/superpowers/plans/2026-09-05-resume-pipeline-phase-1.md`) is complete and **applied** — merged as PRs #94 and #95 on 2026-09-13. The `resume/` lifecycle prefixes, the least-privilege IAM policy, and the four `RESUME_*`/`OPENROUTER_*` Vercel env vars are live. Do not start this phase against un-applied infra.

## Global Constraints

- Branch from `dev`; PRs target `dev`. Do not work on `dev`, `stage`, or `main` directly.
- Commit messages end with: `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`
- PR descriptions end with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- Add a `CHANGELOG.md` entry under `## [Unreleased]` in the PR.
- App unit tests: `cd app && npm test` (Vitest only). **CI's `test` job runs Vitest *and* Playwright *and* lint, and fails if any fails** — `npm test` alone is not the gate.
- App lint: `cd app && npm run lint`. Typecheck: `cd app && npx tsc --noEmit`.
- Local build needs the Keystatic vars: `cd app && KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build`. Without them the build dies *after* a successful compile with `Failed to collect configuration for /api/keystatic/[...params]` — a missing-env-var error that looks like a build bug.
- **The app's AWS region env var is `APP_AWS_REGION`, not `AWS_REGION`** — deliberately named to avoid colliding with reserved Vercel/AWS SDK vars.
- **Resume objects live in main's bucket on every branch**, named by `RESUME_BUCKET_NAME`. `S3_BUCKET_NAME` is the per-branch *audio* bucket and must not be used for resume keys.
- **Never log, echo, or write `OPENROUTER_API_KEY`** — not into a test fixture, a comment, a commit message, or an error message returned to the client.
- Node/TS style: match surrounding code. Named exports from `app/lib/*.ts` with a colocated `*.test.ts`.
- Existing presigned-URL TTL is `DOWNLOAD_URL_TTL_SECONDS = 300` in `app/lib/aws.ts`. Reuse it; do not hardcode `300`.
- Follow the "Merging a PR" sequence in `CLAUDE.md`: green `test`, then `aws-devops-agent/release-readiness-review` reporting `change approved` (a **commit status**, not a check-run), then **read the inline review comments** at `gh api --paginate repos/DataCrusade1999/supreme-enigma/pulls/<N>/comments` — `--paginate` is not optional — then squash-merge.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `app/package.json` | dependencies | Modify: add `zod` as a direct dependency |
| `app/vitest.config.ts` | test runner config | Modify: add the `@/` resolve alias |
| `app/lib/resume-schema.ts` | the zod schema + inferred types; JSON Schema for OpenRouter | **Create** |
| `app/lib/resume-schema.test.ts` | schema tests | **Create** |
| `app/lib/resume-keys.ts` | draft/current/archive S3 key construction | **Create** |
| `app/lib/resume-keys.test.ts` | key tests | **Create** |
| `app/lib/aws.ts` | S3 client, keys, presigning | Modify: add bucket-aware presign helpers |
| `app/lib/aws.test.ts` | tests for the above | Modify |
| `app/lib/openrouter.ts` | the OpenRouter chat-completions call | **Create** |
| `app/lib/openrouter.test.ts` | tests for the above | **Create** |
| `app/lib/route-gate.ts` | what is gated + tool display names | Modify: add the resume admin prefixes |
| `app/lib/route-gate.test.ts` | gate tests | Modify |
| `app/app/api/resume/upload-url/route.ts` | presign a draft PDF PUT | **Create** |
| `app/app/api/resume/extract/route.ts` | PDF → JSON via OpenRouter | **Create** |
| `app/app/api/resume/draft/route.ts` | save a corrected draft | **Create** |
| `app/app/api/resume/publish/route.ts` | archive + promote a draft | **Create** |
| `app/app/tools/resume-admin/page.tsx` | the admin UI | **Create** |
| `app/app/tools/resume-admin/preview/[draftId]/page.tsx` | draft preview | **Create** |
| `app/e2e/resume-admin.spec.ts` | gate + render e2e | **Create** |
| `CHANGELOG.md` | release notes | Modify |

`resume-keys.ts` is separate from `aws.ts` because `aws.ts` is the audio path's S3 module and its `keyForUpload` writes to `uploads/` — a prefix whose 1-day expiry would delete a resume. Keeping the resume key vocabulary in its own file makes that mistake hard to make by accident.

`openrouter.ts` is separate from the extract route so the HTTP contract can be unit-tested against a mocked `fetch` without constructing a `NextRequest`.

---

## Task 1: The resume schema

The single source of truth for the model's output contract, the review-step validation, and Phase 3's page props.

**Files:**
- Modify: `app/package.json`
- Create: `app/lib/resume-schema.ts`
- Test: `app/lib/resume-schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `resumeSchema` — a zod object schema
  - `type Resume = z.infer<typeof resumeSchema>`
  - `resumeJsonSchema` — the plain JSON Schema object passed to OpenRouter's `response_format`

- [ ] **Step 1: Add zod as a direct dependency**

zod 4.4.3 is already present in `app/node_modules` but only transitively, via Keystatic. Relying on a transitive dependency means a Keystatic bump can remove it without warning.

```bash
cd app && npm install zod
```

Confirm it landed in `dependencies`, not `devDependencies`:

```bash
cd app && node -e "console.log(require('./package.json').dependencies.zod)"
```

Expected: a version string beginning `^4.`.

- [ ] **Step 2: Teach Vitest the `@/` alias**

**This is load-bearing for every later task and easy to miss.** `app/tsconfig.json` maps `@/*` → `./*`, and the route handlers import `@/lib/aws`. Next resolves that; **Vitest does not** — `vitest.config.ts` has only `@vitejs/plugin-react` and no `resolve.alias`, and no existing test uses the alias, so the gap is invisible today.

It matters because `vi.mock()` must name the *same specifier the module under test imports*. A route that does `import { getObjectBytes } from "@/lib/aws"` can only be mocked with `vi.mock("@/lib/aws")`, which fails to resolve until this is fixed.

Add the alias to `app/vitest.config.ts`, leaving `exclude` exactly as it is — spreading `configDefaults.exclude` there is deliberate and load-bearing:

```ts
import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  // tsconfig maps @/* to ./*, and the route handlers import "@/lib/…".
  // Vitest does not read tsconfig paths, so without this every vi.mock("@/…")
  // fails to resolve — and vi.mock must match the specifier the module under
  // test actually imports.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    setupFiles: ["./vitest.setup.ts"],
    // Vitest replaces its default exclude list entirely when one is given, so
    // spread the defaults rather than restating them — a hand-written list
    // silently drops whichever defaults it forgets.
    exclude: [...configDefaults.exclude, "**/.next/**", "e2e/**"],
  },
});
```

Prove it resolves before building anything on it. Create `app/lib/alias-smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COOKIE_NAME } from "@/lib/auth";

describe("the @/ alias", () => {
  it("resolves in Vitest, not just in Next", () => {
    expect(COOKIE_NAME).toBe("looper_session");
  });
});
```

```bash
cd app && npx vitest run lib/alias-smoke.test.ts
```

Expected: PASS. A `Failed to resolve import "@/lib/auth"` means the alias did not take — fix that before continuing, because every route test in Tasks 5 and 7-9 depends on it.

Then delete the smoke test; it has done its job and the alias is exercised by every later test:

```bash
rm app/lib/alias-smoke.test.ts
```

- [ ] **Step 3: Confirm the existing suite still passes with the alias added**

```bash
cd app && npm test
```

Expected: PASS, same count as before the change — the alias adds a resolution path, it does not change any existing one.

- [ ] **Step 4: Write the failing test**

Create `app/lib/resume-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resumeSchema, resumeJsonSchema } from "./resume-schema";

const VALID = {
  headline: {
    name: "Ashutosh Pandey",
    title: "QA Engineer & DevOps Operator",
    summary: "Builds reliable systems and removes manual toil.",
  },
  work: [
    {
      role: "QA Engineer & DevOps Operator",
      org: "Creowis Technologies Pvt. Ltd.",
      start: "July 2025",
      end: "Present",
      bullets: ["Designed and maintained automated test suites using Playwright."],
    },
  ],
  skills: [{ group: "Languages", items: ["JavaScript", "Python"] }],
};

describe("resumeSchema", () => {
  it("accepts a well-formed resume", () => {
    expect(resumeSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a missing headline field", () => {
    const bad = { ...VALID, headline: { name: "A", title: "B" } };
    expect(resumeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a wrong type", () => {
    const bad = { ...VALID, work: "not an array" };
    expect(resumeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    // strict(): the model must not invent fields the page will silently drop.
    const bad = { ...VALID, education: [] };
    expect(resumeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty work array", () => {
    expect(resumeSchema.safeParse({ ...VALID, work: [] }).success).toBe(false);
  });

  it("rejects a role with no bullets", () => {
    const bad = { ...VALID, work: [{ ...VALID.work[0], bullets: [] }] };
    expect(resumeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects blank strings, which parse as valid JSON but are useless", () => {
    const bad = { ...VALID, headline: { ...VALID.headline, name: "   " } };
    expect(resumeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("resumeJsonSchema", () => {
  it("is a plain object OpenRouter can accept, not a zod instance", () => {
    expect(resumeJsonSchema.type).toBe("object");
    expect(JSON.parse(JSON.stringify(resumeJsonSchema))).toEqual(resumeJsonSchema);
  });

  it("marks every top-level field required and forbids extras", () => {
    // strict: true on OpenRouter's side requires additionalProperties: false
    // and a `required` listing every property, at every level.
    expect(resumeJsonSchema.additionalProperties).toBe(false);
    expect(resumeJsonSchema.required).toEqual(["headline", "work", "skills"]);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
cd app && npx vitest run lib/resume-schema.test.ts
```

Expected: FAIL — cannot resolve `./resume-schema`.

- [ ] **Step 6: Implement**

Create `app/lib/resume-schema.ts`:

```ts
import { z } from "zod";

// Trimmed-and-non-empty rather than plain string(): the model returning " "
// is valid JSON and valid `string`, but renders as a blank line on the page.
const text = z.string().trim().min(1);

export const resumeSchema = z
  .object({
    headline: z
      .object({
        name: text,
        title: text,
        summary: text,
      })
      .strict(),
    work: z
      .array(
        z
          .object({
            role: text,
            org: text,
            start: text,
            // "Present" for a current role — see the extraction prompt.
            end: text,
            bullets: z.array(text).min(1),
          })
          .strict(),
      )
      .min(1),
    skills: z
      .array(
        z
          .object({
            group: text,
            items: z.array(text).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type Resume = z.infer<typeof resumeSchema>;

// Hand-written rather than generated from the zod schema. OpenRouter's
// `strict: true` mode demands `additionalProperties: false` and an exhaustive
// `required` at every level, and the generators do not all emit that shape —
// so the contract sent to the model is written out explicitly and pinned by a
// test, rather than being whatever a converter produced this week.
export const resumeJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "work", "skills"],
  properties: {
    headline: {
      type: "object",
      additionalProperties: false,
      required: ["name", "title", "summary"],
      properties: {
        name: { type: "string" },
        title: { type: "string" },
        summary: { type: "string" },
      },
    },
    work: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "org", "start", "end", "bullets"],
        properties: {
          role: { type: "string" },
          org: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
        },
      },
    },
    skills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["group", "items"],
        properties: {
          group: { type: "string" },
          items: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd app && npx vitest run lib/resume-schema.test.ts
```

Expected: PASS, all nine cases.

- [ ] **Step 8: Commit**

```bash
git add app/package.json app/package-lock.json app/vitest.config.ts \
        app/lib/resume-schema.ts app/lib/resume-schema.test.ts
git commit -m "feat(resume): add the resume schema

Adds zod as a direct dependency (it was only present transitively via
Keystatic) and teaches Vitest the @/ alias, which tsconfig defines and
the route handlers use but Vitest could not previously resolve.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 2: Resume S3 key helpers

**Files:**
- Create: `app/lib/resume-keys.ts`
- Test: `app/lib/resume-keys.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `newDraftId(): string`
  - `draftPdfKey(draftId: string): string`
  - `draftJsonKey(draftId: string): string`
  - `CURRENT_PDF_KEY: string`, `CURRENT_JSON_KEY: string`
  - `archiveKeys(now?: Date): { pdf: string; json: string }`
  - `resumeBucket(): string`

- [ ] **Step 1: Write the failing test**

Create `app/lib/resume-keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  newDraftId,
  draftPdfKey,
  draftJsonKey,
  archiveKeys,
  resumeBucket,
  CURRENT_PDF_KEY,
  CURRENT_JSON_KEY,
} from "./resume-keys";

describe("resume keys", () => {
  it("builds draft keys under resume/drafts/<id>/", () => {
    expect(draftPdfKey("abc")).toBe("resume/drafts/abc/resume.pdf");
    expect(draftJsonKey("abc")).toBe("resume/drafts/abc/resume.json");
  });

  it("never puts a resume key under uploads/ or outputs/", () => {
    // uploads/ and outputs/ expire after 1 day. A resume key landing there
    // would be deleted overnight — this is the mistake the module exists to
    // prevent, so it is asserted rather than assumed.
    const keys = [
      draftPdfKey("abc"),
      draftJsonKey("abc"),
      CURRENT_PDF_KEY,
      CURRENT_JSON_KEY,
      archiveKeys(new Date("2026-09-13T10:00:00Z")).pdf,
    ];
    for (const key of keys) {
      expect(key.startsWith("resume/")).toBe(true);
    }
  });

  it("uses fixed keys for the live resume", () => {
    expect(CURRENT_PDF_KEY).toBe("resume/current.pdf");
    expect(CURRENT_JSON_KEY).toBe("resume/current.json");
  });

  it("builds archive keys from an ISO timestamp with no colons", () => {
    // Colons are legal in S3 keys but awkward in URLs and CLI quoting.
    const { pdf, json } = archiveKeys(new Date("2026-09-13T10:20:30.000Z"));
    expect(pdf).toBe("resume/archive/2026-09-13T10-20-30-000Z.pdf");
    expect(json).toBe("resume/archive/2026-09-13T10-20-30-000Z.json");
    expect(pdf).not.toContain(":");
  });

  it("mints a distinct draft id each time", () => {
    expect(newDraftId()).not.toBe(newDraftId());
  });

  it("rejects a draft id that could escape the prefix", () => {
    // The draft id arrives from the client, so it is untrusted input that is
    // concatenated straight into an S3 key.
    expect(() => draftPdfKey("../current")).toThrow();
    expect(() => draftPdfKey("a/b")).toThrow();
    expect(() => draftPdfKey("")).toThrow();
  });

  it("reads the bucket from RESUME_BUCKET_NAME, not S3_BUCKET_NAME", () => {
    // S3_BUCKET_NAME is the per-branch AUDIO bucket. Resume data lives in
    // main's bucket on every branch — see the design spec §4.1.
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
    process.env.S3_BUCKET_NAME = "audio-bucket";
    expect(resumeBucket()).toBe("resume-bucket");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run lib/resume-keys.test.ts
```

Expected: FAIL — cannot resolve `./resume-keys`.

- [ ] **Step 3: Implement**

Create `app/lib/resume-keys.ts`:

```ts
import { randomUUID } from "crypto";

// Deliberately a separate module from lib/aws.ts. That file's keyForUpload
// writes to uploads/, whose 1-day lifecycle rule would delete a resume
// overnight — keeping the resume key vocabulary apart makes that mistake
// hard to make by accident. See the design spec §4.2.

export const CURRENT_PDF_KEY = "resume/current.pdf";
export const CURRENT_JSON_KEY = "resume/current.json";

export function newDraftId(): string {
  return randomUUID();
}

function assertSafeDraftId(draftId: string): void {
  // The draft id comes from the client and is concatenated into an S3 key.
  // Anything but plain uuid characters could walk out of the prefix and
  // overwrite resume/current.pdf.
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(draftId)) {
    throw new Error("invalid draft id");
  }
}

export function draftPdfKey(draftId: string): string {
  assertSafeDraftId(draftId);
  return `resume/drafts/${draftId}/resume.pdf`;
}

export function draftJsonKey(draftId: string): string {
  assertSafeDraftId(draftId);
  return `resume/drafts/${draftId}/resume.json`;
}

export function archiveKeys(now = new Date()): { pdf: string; json: string } {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return {
    pdf: `resume/archive/${stamp}.pdf`,
    json: `resume/archive/${stamp}.json`,
  };
}

// All three branches read and write main's bucket for resume data, so this is
// the env-agnostic RESUME_BUCKET_NAME rather than the per-branch
// S3_BUCKET_NAME. See the design spec §4.1.
export function resumeBucket(): string {
  return process.env.RESUME_BUCKET_NAME!;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run lib/resume-keys.test.ts
```

Expected: PASS, all seven cases.

- [ ] **Step 5: Commit**

```bash
git add app/lib/resume-keys.ts app/lib/resume-keys.test.ts
git commit -m "feat(resume): add S3 key helpers for drafts, current, and archive

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 3: Bucket-aware S3 helpers

`presignUpload` and `presignDownload` hardcode `process.env.S3_BUCKET_NAME`, so neither can address the resume bucket. Add explicit-bucket variants and make the existing functions thin wrappers, so the audio path is unchanged.

**Files:**
- Modify: `app/lib/aws.ts`
- Test: `app/lib/aws.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `presignUploadTo(bucket: string, key: string, contentType: string, contentLength: number): Promise<string>`
  - `presignDownloadFrom(bucket: string, key: string): Promise<string>`
  - `getObjectBytes(bucket: string, key: string): Promise<Buffer>`
  - `putObjectJson(bucket: string, key: string, body: unknown): Promise<void>`
  - `objectExists(bucket: string, key: string): Promise<boolean>`
  - `copyObject(bucket: string, fromKey: string, toKey: string): Promise<void>`

  `presignUpload(key, contentType, contentLength)` and `presignDownload(key)` keep their current signatures and now delegate to the `*To`/`*From` variants with `process.env.S3_BUCKET_NAME`.

- [ ] **Step 1: Write the failing test**

Append to `app/lib/aws.test.ts`, merging the new names into the existing `./aws` import rather than adding a second import statement:

```ts
describe("bucket-aware helpers", () => {
  it("signs an upload against the bucket it is given, not S3_BUCKET_NAME", async () => {
    process.env.APP_AWS_REGION = "us-east-1";
    process.env.S3_BUCKET_NAME = "audio-bucket";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";

    const url = await presignUploadTo(
      "resume-bucket",
      "resume/drafts/abc/resume.pdf",
      "application/pdf",
      1234,
    );

    expect(url).toContain("resume-bucket");
    expect(url).not.toContain("audio-bucket");
    expect(decodeURIComponent(url)).toContain("content-length");
  });

  it("signs a download against the bucket it is given", async () => {
    process.env.APP_AWS_REGION = "us-east-1";
    process.env.S3_BUCKET_NAME = "audio-bucket";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";

    const url = await presignDownloadFrom("resume-bucket", "resume/current.pdf");

    expect(url).toContain("resume-bucket");
    expect(url).not.toContain("audio-bucket");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run lib/aws.test.ts
```

Expected: FAIL — `presignUploadTo` is not exported.

- [ ] **Step 3: Implement**

In `app/lib/aws.ts`, add these imports to the existing `@aws-sdk/client-s3` import:

```ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
```

Replace `presignUpload` and `presignDownload` with the bucket-aware pair plus their wrappers, and add the object helpers:

```ts
// The bucket is a parameter because resume objects live in main's bucket on
// every branch (RESUME_BUCKET_NAME) while audio lives in the per-branch bucket
// (S3_BUCKET_NAME). The two-argument wrappers below keep the audio call sites
// unchanged. See the design spec §4.1.
export async function presignUploadTo(
  bucket: string,
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(getS3Client(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

export async function presignDownloadFrom(bucket: string, key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(getS3Client(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

export async function presignUpload(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  return presignUploadTo(process.env.S3_BUCKET_NAME!, key, contentType, contentLength);
}

export async function presignDownload(key: string): Promise<string> {
  return presignDownloadFrom(process.env.S3_BUCKET_NAME!, key);
}

export async function getObjectBytes(bucket: string, key: string): Promise<Buffer> {
  const res = await getS3Client().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function putObjectJson(
  bucket: string,
  key: string,
  body: unknown,
): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: "application/json",
      Body: JSON.stringify(body, null, 2),
    }),
  );
}

export async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    // Only "it isn't there" is a false; anything else (credentials, network,
    // a bucket that does not exist) must surface rather than be reported as
    // an absent object, which callers treat as a normal first-publish state.
    const name = (err as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey") return false;
    throw err;
  }
}

export async function copyObject(
  bucket: string,
  fromKey: string,
  toKey: string,
): Promise<void> {
  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${fromKey}`,
      Key: toKey,
    }),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run lib/aws.test.ts
```

Expected: PASS — the new cases plus the existing `keyForUpload`, `deriveOutputKey` and upload-size-limit cases, which must not have regressed.

- [ ] **Step 5: Verify the audio path still typechecks**

```bash
cd app && npx tsc --noEmit && npm run lint
```

Expected: no errors. `app/app/api/looper/upload-url/route.ts` and `app/app/api/looper/process/route.ts` call the two-argument wrappers and need no change.

- [ ] **Step 6: Commit**

```bash
git add app/lib/aws.ts app/lib/aws.test.ts
git commit -m "feat(resume): add bucket-aware S3 helpers

Resume objects live in main's bucket on every branch, so presigning and
object access need an explicit bucket. The audio call sites keep their
existing two-argument wrappers.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 4: Gate the resume admin routes

**Files:**
- Modify: `app/lib/route-gate.ts`
- Test: `app/lib/route-gate.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `/tools/resume-admin` and `/api/resume` are gated; `toolNameFor("/tools/resume-admin")` returns `"Resume admin"`

- [ ] **Step 1: Write the failing test**

Append to `app/lib/route-gate.test.ts`:

```ts
describe("resume admin gating", () => {
  it("gates the admin page and its sub-paths", () => {
    expect(isGatedPath("/tools/resume-admin")).toBe(true);
    expect(isGatedPath("/tools/resume-admin/preview/abc")).toBe(true);
  });

  it("gates the resume API", () => {
    expect(isGatedPath("/api/resume/upload-url")).toBe(true);
    expect(isGatedPath("/api/resume/extract")).toBe(true);
    expect(isGatedPath("/api/resume/publish")).toBe(true);
  });

  it("leaves the public resume page and PDF ungated", () => {
    // These are the visitor-facing pages Phase 3 builds. Gating them by an
    // over-broad prefix match would hide the portfolio behind the password.
    expect(isGatedPath("/resume")).toBe(false);
    expect(isGatedPath("/resume.pdf")).toBe(false);
  });

  it("names the destination on the login gate", () => {
    expect(toolNameFor("/tools/resume-admin")).toBe("Resume admin");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run lib/route-gate.test.ts
```

Expected: FAIL — `isGatedPath("/tools/resume-admin")` returns `false`.

- [ ] **Step 3: Implement**

In `app/lib/route-gate.ts`:

```ts
const GATED_PREFIXES = [
  "/tools/bgm-looper",
  "/api/looper",
  "/tools/resume-admin",
  "/api/resume",
  "/keystatic",
  "/api/keystatic",
];
```

and add to `TOOL_NAMES`:

```ts
  "/tools/resume-admin": "Resume admin",
```

Note `matches()` requires a `/` boundary or an exact match, so `/api/resume` does not match `/resume` or `/resume.pdf` — which is what keeps the public pages ungated.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run lib/route-gate.test.ts
```

Expected: PASS, including the existing cases.

- [ ] **Step 5: Commit**

```bash
git add app/lib/route-gate.ts app/lib/route-gate.test.ts
git commit -m "feat(resume): gate the resume admin routes

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 5: The draft upload route

**Files:**
- Create: `app/app/api/resume/upload-url/route.ts`
- Test: `app/app/api/resume/upload-url/route.test.ts`

**Interfaces:**
- Consumes: `newDraftId`, `draftPdfKey`, `resumeBucket` (Task 2); `presignUploadTo` (Task 3); `MAX_RESUME_UPLOAD_BYTES` (Phase 1, already in `app/lib/aws.ts`)
- Produces: `POST /api/resume/upload-url` → `{ draftId, uploadUrl }`

- [ ] **Step 1: Write the failing test**

Create `app/app/api/resume/upload-url/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/aws")>()),
  presignUploadTo: vi.fn(async () => "https://signed.example/put"),
}));

import { POST } from "./route";
import { presignUploadTo } from "@/lib/aws";

function post(body: unknown) {
  return new Request("http://localhost/api/resume/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/resume/upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
  });

  it("returns a draft id and a signed URL", async () => {
    const res = await POST(post({ contentType: "application/pdf", size: 1024 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draftId).toMatch(/^[a-f0-9-]{36}$/);
    expect(body.uploadUrl).toBe("https://signed.example/put");
  });

  it("signs against the resume bucket and a drafts key", async () => {
    await POST(post({ contentType: "application/pdf", size: 1024 }));
    const [bucket, key, contentType, length] = vi.mocked(presignUploadTo).mock.calls[0];
    expect(bucket).toBe("resume-bucket");
    expect(key).toMatch(/^resume\/drafts\/[a-f0-9-]{36}\/resume\.pdf$/);
    expect(contentType).toBe("application/pdf");
    expect(length).toBe(1024);
  });

  it("rejects a non-PDF", async () => {
    // The extraction plugin is configured for PDF; anything else wastes a
    // model call and stores a file nothing can read.
    const res = await POST(post({ contentType: "image/png", size: 1024 }));
    expect(res.status).toBe(415);
    expect(presignUploadTo).not.toHaveBeenCalled();
  });

  it("rejects a file over the 5 MB cap", async () => {
    const res = await POST(post({ contentType: "application/pdf", size: 6 * 1024 * 1024 }));
    expect(res.status).toBe(413);
    expect(presignUploadTo).not.toHaveBeenCalled();
  });

  it("rejects a missing or nonsensical size", async () => {
    expect((await POST(post({ contentType: "application/pdf" }))).status).toBe(400);
    expect((await POST(post({ contentType: "application/pdf", size: 0 }))).status).toBe(400);
    expect((await POST(post({ contentType: "application/pdf", size: -1 }))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run app/api/resume/upload-url/route.test.ts
```

Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement**

Create `app/app/api/resume/upload-url/route.ts`:

```ts
import { NextResponse } from "next/server";
import { MAX_RESUME_UPLOAD_BYTES, presignUploadTo } from "@/lib/aws";
import { draftPdfKey, newDraftId, resumeBucket } from "@/lib/resume-keys";

export async function POST(request: Request) {
  const { contentType, size } = await request.json();

  if (contentType !== "application/pdf") {
    return NextResponse.json({ error: "a PDF is required" }, { status: 415 });
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return NextResponse.json({ error: "size is required" }, { status: 400 });
  }
  // Checked here AND bound into the signature below. The server-side check
  // gives a clean error; the signed ContentLength is what actually stops the
  // bytes landing, since a size checked after the fact has already been paid
  // for. See the design spec §9.1.
  if (size > MAX_RESUME_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  const draftId = newDraftId();
  const uploadUrl = await presignUploadTo(
    resumeBucket(),
    draftPdfKey(draftId),
    contentType,
    size,
  );
  return NextResponse.json({ draftId, uploadUrl });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run app/api/resume/upload-url/route.test.ts
```

Expected: PASS, all five cases.

- [ ] **Step 5: Commit**

```bash
git add app/app/api/resume/upload-url/route.ts app/app/api/resume/upload-url/route.test.ts
git commit -m "feat(resume): add the draft upload-url route

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 6: The OpenRouter client

**Files:**
- Create: `app/lib/openrouter.ts`
- Test: `app/lib/openrouter.test.ts`

**Interfaces:**
- Consumes: `resumeJsonSchema` (Task 1)
- Produces: `extractResumeFromPdf(pdf: Buffer): Promise<unknown>` — returns the parsed JSON content, unvalidated. Throws `Error` on a non-200, a missing content field, or unparseable JSON.

The request shape here is the one measured working on 2026-09-12 (spec §5.2): `anthropic/claude-haiku-4.5`, `file-parser` with `engine: "native"`, `response_format: json_schema` with `strict: true`, `max_tokens: 4000`, at $0.0071 per run. Do not change it without re-measuring.

- [ ] **Step 1: Write the failing test**

Create `app/lib/openrouter.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractResumeFromPdf } from "./openrouter";

const PDF = Buffer.from("%PDF-1.4 fake");

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("extractResumeFromPdf", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_BASE_URL = "https://openrouter.example/api/v1";
    process.env.OPENROUTER_MODEL = "anthropic/claude-haiku-4.5";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed JSON content on success", async () => {
    const payload = { headline: { name: "A", title: "B", summary: "C" } };
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(200, { choices: [{ message: { content: JSON.stringify(payload) } }] }),
    );

    await expect(extractResumeFromPdf(PDF)).resolves.toEqual(payload);
  });

  it("sends the PDF as a base64 data URL with the file-parser plugin", async () => {
    const fetchMock = mockFetchOnce(200, {
      choices: [{ message: { content: "{}" } }],
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractResumeFromPdf(PDF);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.example/api/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("anthropic/claude-haiku-4.5");
    expect(body.max_tokens).toBe(4000);
    expect(body.plugins).toEqual([{ id: "file-parser", pdf: { engine: "native" } }]);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    const file = body.messages[0].content.find((c: { type: string }) => c.type === "file");
    expect(file.file.file_data).toBe(`data:application/pdf;base64,${PDF.toString("base64")}`);
  });

  it("throws on a non-200 without leaking the key", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(402, { error: { message: "insufficient credit" } }));

    await expect(extractResumeFromPdf(PDF)).rejects.toThrow(/insufficient credit/);
    await expect(extractResumeFromPdf(PDF)).rejects.not.toThrow(/sk-or-test/);
  });

  it("throws when the response carries no content", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, { choices: [] }));
    await expect(extractResumeFromPdf(PDF)).rejects.toThrow(/no content/i);
  });

  it("throws when the content is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(200, { choices: [{ message: { content: "I cannot help with that." } }] }),
    );
    await expect(extractResumeFromPdf(PDF)).rejects.toThrow(/not valid JSON/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run lib/openrouter.test.ts
```

Expected: FAIL — cannot resolve `./openrouter`.

- [ ] **Step 3: Implement**

Create `app/lib/openrouter.ts`:

```ts
import { resumeJsonSchema } from "./resume-schema";

// Bounds worst-case output cost per invocation. See the design spec §9.1.
const MAX_TOKENS = 4000;

const PROMPT =
  "Extract this resume into the required JSON schema. Use the exact wording from " +
  'the document for bullets. For a current role, use "Present" as the end value.';

/**
 * Send a resume PDF to OpenRouter and return the parsed JSON it replies with.
 *
 * The response is NOT schema-validated here — the caller validates with the zod
 * schema, so that a provider-side `strict: true` guarantee and our own contract
 * are checked independently. Returns `unknown` to make that explicit.
 *
 * This request shape was measured end to end on 2026-09-12 at $0.0071 per run
 * (spec §5.2). Changing the model, the plugin, or the engine means re-measuring.
 */
export async function extractResumeFromPdf(pdf: Buffer): Promise<unknown> {
  const res = await fetch(`${process.env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL,
      max_tokens: MAX_TOKENS,
      // OpenRouter cannot read from S3 by reference, so the bytes transit this
      // route as a data URL. At the 5 MB cap that is ~6.7 MB base64 in function
      // memory — which is why the cap is not negotiable. See spec §5.3.
      plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "resume", strict: true, schema: resumeJsonSchema },
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            {
              type: "file",
              file: {
                filename: "resume.pdf",
                file_data: `data:application/pdf;base64,${pdf.toString("base64")}`,
              },
            },
          ],
        },
      ],
    }),
  });

  const json = await res.json();

  if (!res.ok) {
    // Only the provider's own message is surfaced. The request carried the API
    // key in a header and must never be echoed into an error.
    const message = json?.error?.message ?? `status ${res.status}`;
    throw new Error(`OpenRouter request failed: ${message}`);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("OpenRouter returned no content");
  }

  try {
    return JSON.parse(content);
  } catch {
    // strict: true should make this impossible, but a refusal or a truncated
    // response still arrives as a 200 with prose in the content field.
    throw new Error("OpenRouter response was not valid JSON");
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run lib/openrouter.test.ts
```

Expected: PASS, all five cases.

- [ ] **Step 5: Commit**

```bash
git add app/lib/openrouter.ts app/lib/openrouter.test.ts
git commit -m "feat(resume): add the OpenRouter extraction client

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 7: The extract route

**Files:**
- Create: `app/app/api/resume/extract/route.ts`
- Test: `app/app/api/resume/extract/route.test.ts`

**Interfaces:**
- Consumes: `draftPdfKey`, `draftJsonKey`, `resumeBucket` (Task 2); `getObjectBytes`, `putObjectJson`, `objectExists` (Task 3); `extractResumeFromPdf` (Task 6); `resumeSchema` (Task 1)
- Produces: `POST /api/resume/extract` → `{ draftId, resume }`

- [ ] **Step 1: Write the failing test**

Create `app/app/api/resume/extract/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  getObjectBytes: vi.fn(),
  putObjectJson: vi.fn(),
  objectExists: vi.fn(),
}));
vi.mock("@/lib/openrouter", () => ({ extractResumeFromPdf: vi.fn() }));

import { POST } from "./route";
import { getObjectBytes, putObjectJson, objectExists } from "@/lib/aws";
import { extractResumeFromPdf } from "@/lib/openrouter";

const VALID = {
  headline: { name: "A", title: "B", summary: "C" },
  work: [{ role: "R", org: "O", start: "2025", end: "Present", bullets: ["did a thing"] }],
  skills: [{ group: "Languages", items: ["TypeScript"] }],
};

function post(body: unknown) {
  return new Request("http://localhost/api/resume/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/resume/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
    // Default world: the PDF has been uploaded, no extraction has run yet.
    // The route asks about both keys, so the mock must distinguish them.
    vi.mocked(objectExists).mockImplementation(async (_bucket, key) =>
      key.endsWith("resume.pdf"),
    );
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from("%PDF"));
    vi.mocked(extractResumeFromPdf).mockResolvedValue(VALID);
  });

  it("extracts, validates, and writes the draft JSON", async () => {
    const res = await POST(post({ draftId: "abc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ draftId: "abc", resume: VALID });

    const [bucket, key, body] = vi.mocked(putObjectJson).mock.calls[0];
    expect(bucket).toBe("resume-bucket");
    expect(key).toBe("resume/drafts/abc/resume.json");
    expect(body).toEqual(VALID);
  });

  it("is idempotent — an existing draft JSON short-circuits the model call", async () => {
    // A refresh loop must not be able to generate repeated paid model calls.
    // See the design spec §9.1.
    vi.mocked(objectExists).mockResolvedValue(true); // both keys present
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(VALID)));

    const res = await POST(post({ draftId: "abc" }));

    expect(res.status).toBe(200);
    expect(extractResumeFromPdf).not.toHaveBeenCalled();
    expect(putObjectJson).not.toHaveBeenCalled();
  });

  it("re-extracts when force is set", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    await POST(post({ draftId: "abc", force: true }));
    expect(extractResumeFromPdf).toHaveBeenCalledTimes(1);
  });

  it("does not write to S3 when the model call fails", async () => {
    vi.mocked(extractResumeFromPdf).mockRejectedValue(new Error("upstream exploded"));
    const res = await POST(post({ draftId: "abc" }));
    expect(res.status).toBe(502);
    expect(putObjectJson).not.toHaveBeenCalled();
  });

  it("does not write JSON that is valid JSON but fails the schema", async () => {
    vi.mocked(extractResumeFromPdf).mockResolvedValue({ headline: { name: "only" } });
    const res = await POST(post({ draftId: "abc" }));

    expect(res.status).toBe(422);
    expect(putObjectJson).not.toHaveBeenCalled();
    // The raw response comes back so the review UI can show what arrived
    // rather than just reporting a failure.
    expect(await res.json()).toHaveProperty("raw");
  });

  it("rejects a draft id that could escape the prefix", async () => {
    const res = await POST(post({ draftId: "../current" }));
    expect(res.status).toBe(400);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("404s for a well-formed draft id whose PDF was never uploaded", async () => {
    // Spec §5.3 step 1: confirm the object exists before doing anything else.
    // Without this, a stale draft id from a bookmarked admin page reaches
    // getObjectBytes and surfaces as an unhandled 500.
    vi.mocked(objectExists).mockResolvedValue(false); // neither key present

    const res = await POST(post({ draftId: "never-uploaded" }));

    expect(res.status).toBe(404);
    expect(extractResumeFromPdf).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run app/api/resume/extract/route.test.ts
```

Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement**

Create `app/app/api/resume/extract/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getObjectBytes, objectExists, putObjectJson } from "@/lib/aws";
import { extractResumeFromPdf } from "@/lib/openrouter";
import { draftJsonKey, draftPdfKey, resumeBucket } from "@/lib/resume-keys";
import { resumeSchema } from "@/lib/resume-schema";

// Extraction routinely takes longer than Vercel's default function timeout:
// the PDF transits the route, and the model reads every page.
export const maxDuration = 60;

export async function POST(request: Request) {
  const { draftId, force } = await request.json();

  let pdfKey: string;
  let jsonKey: string;
  try {
    pdfKey = draftPdfKey(draftId);
    jsonKey = draftJsonKey(draftId);
  } catch {
    return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
  }

  const bucket = resumeBucket();

  // Idempotent per draft: a reload of the admin page must not spend another
  // model call. Re-extraction is an explicit choice. See the design spec §9.1.
  if (!force && (await objectExists(bucket, jsonKey))) {
    const existing = await getObjectBytes(bucket, jsonKey);
    return NextResponse.json({
      draftId,
      resume: JSON.parse(existing.toString("utf8")),
      cached: true,
    });
  }

  // Spec §5.3 step 1 — confirm the PDF is there before spending anything.
  // A stale draft id from a bookmarked admin page would otherwise reach
  // getObjectBytes and surface as an unhandled 500.
  if (!(await objectExists(bucket, pdfKey))) {
    return NextResponse.json({ error: "no PDF for that draft" }, { status: 404 });
  }

  const pdf = await getObjectBytes(bucket, pdfKey);

  let raw: unknown;
  try {
    raw = await extractResumeFromPdf(pdf);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "extraction failed" },
      { status: 502 },
    );
  }

  // Validated before anything is written, so a malformed extraction never
  // lands in S3 — the review UI shows `raw` instead. See the design spec §5.3.
  const parsed = resumeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "extraction did not match the schema", issues: parsed.error.issues, raw },
      { status: 422 },
    );
  }

  await putObjectJson(bucket, jsonKey, parsed.data);
  return NextResponse.json({ draftId, resume: parsed.data });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run app/api/resume/extract/route.test.ts
```

Expected: PASS, all six cases.

- [ ] **Step 5: Commit**

```bash
git add app/app/api/resume/extract/route.ts app/app/api/resume/extract/route.test.ts
git commit -m "feat(resume): add the extraction route

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 8: The draft-save route

**Files:**
- Create: `app/app/api/resume/draft/route.ts`
- Test: `app/app/api/resume/draft/route.test.ts`

**Interfaces:**
- Consumes: `draftJsonKey`, `resumeBucket` (Task 2); `putObjectJson`, `getObjectBytes` (Task 3); `resumeSchema` (Task 1)
- Produces: `PUT /api/resume/draft` → `{ ok: true }`; `GET /api/resume/draft?draftId=<id>` → `{ resume }`

- [ ] **Step 1: Write the failing test**

Create `app/app/api/resume/draft/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  putObjectJson: vi.fn(),
  getObjectBytes: vi.fn(),
}));

import { PUT, GET } from "./route";
import { putObjectJson, getObjectBytes } from "@/lib/aws";

const VALID = {
  headline: { name: "A", title: "B", summary: "C" },
  work: [{ role: "R", org: "O", start: "2025", end: "Present", bullets: ["did a thing"] }],
  skills: [{ group: "Languages", items: ["TypeScript"] }],
};

describe("/api/resume/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
  });

  it("saves a valid corrected draft", async () => {
    const res = await PUT(
      new Request("http://localhost/api/resume/draft", {
        method: "PUT",
        body: JSON.stringify({ draftId: "abc", resume: VALID }),
      }),
    );

    expect(res.status).toBe(200);
    const [bucket, key, body] = vi.mocked(putObjectJson).mock.calls[0];
    expect(bucket).toBe("resume-bucket");
    expect(key).toBe("resume/drafts/abc/resume.json");
    expect(body).toEqual(VALID);
  });

  it("re-validates server-side and refuses an invalid edit", async () => {
    // The client validates as you type, but the client is not the authority —
    // a hand-crafted request must not be able to write malformed JSON.
    const res = await PUT(
      new Request("http://localhost/api/resume/draft", {
        method: "PUT",
        body: JSON.stringify({ draftId: "abc", resume: { headline: {} } }),
      }),
    );

    expect(res.status).toBe(422);
    expect(putObjectJson).not.toHaveBeenCalled();
  });

  it("reads a draft back", async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(VALID)));
    const res = await GET(
      new Request("http://localhost/api/resume/draft?draftId=abc"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resume: VALID });
  });

  it("rejects an unsafe draft id on both verbs", async () => {
    const put = await PUT(
      new Request("http://localhost/api/resume/draft", {
        method: "PUT",
        body: JSON.stringify({ draftId: "../current", resume: VALID }),
      }),
    );
    expect(put.status).toBe(400);

    const get = await GET(
      new Request("http://localhost/api/resume/draft?draftId=../current"),
    );
    expect(get.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run app/api/resume/draft/route.test.ts
```

Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement**

Create `app/app/api/resume/draft/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getObjectBytes, putObjectJson } from "@/lib/aws";
import { draftJsonKey, resumeBucket } from "@/lib/resume-keys";
import { resumeSchema } from "@/lib/resume-schema";

export async function PUT(request: Request) {
  const { draftId, resume } = await request.json();

  let key: string;
  try {
    key = draftJsonKey(draftId);
  } catch {
    return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
  }

  // Re-validated server-side. The review UI validates as you type, but a
  // client-side check is a convenience, not an authority.
  const parsed = resumeSchema.safeParse(resume);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "resume did not match the schema", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  await putObjectJson(resumeBucket(), key, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const draftId = new URL(request.url).searchParams.get("draftId") ?? "";

  let key: string;
  try {
    key = draftJsonKey(draftId);
  } catch {
    return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
  }

  const bytes = await getObjectBytes(resumeBucket(), key);
  return NextResponse.json({ resume: JSON.parse(bytes.toString("utf8")) });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run app/api/resume/draft/route.test.ts
```

Expected: PASS, all four cases.

- [ ] **Step 5: Commit**

```bash
git add app/app/api/resume/draft/route.ts app/app/api/resume/draft/route.test.ts
git commit -m "feat(resume): add the draft save and read route

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 9: The publish route

**Files:**
- Create: `app/app/api/resume/publish/route.ts`
- Test: `app/app/api/resume/publish/route.test.ts`

**Interfaces:**
- Consumes: `draftPdfKey`, `draftJsonKey`, `archiveKeys`, `CURRENT_PDF_KEY`, `CURRENT_JSON_KEY`, `resumeBucket` (Task 2); `copyObject`, `objectExists` (Task 3)
- Produces: `POST /api/resume/publish` → `{ ok: true, archived: boolean }`

- [ ] **Step 1: Write the failing test**

Create `app/app/api/resume/publish/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({ copyObject: vi.fn(), objectExists: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { POST } from "./route";
import { copyObject, objectExists } from "@/lib/aws";
import { revalidateTag } from "next/cache";

function post(body: unknown) {
  return new Request("http://localhost/api/resume/publish", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/resume/publish", () => {
  const originalEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
    process.env.VERCEL_ENV = "production";
    vi.mocked(objectExists).mockResolvedValue(true);
  });

  afterEach(() => {
    process.env.VERCEL_ENV = originalEnv;
  });

  it("refuses to publish outside production", async () => {
    // Drafts stay writable everywhere so a draft reviewed on dev can be
    // published from production — only publishing is production-only.
    // See the design spec §7.3.
    process.env.VERCEL_ENV = "preview";
    const res = await POST(post({ draftId: "abc" }));
    expect(res.status).toBe(403);
    expect(copyObject).not.toHaveBeenCalled();
  });

  it("archives the existing pair, then promotes the draft", async () => {
    const res = await POST(post({ draftId: "abc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: true });

    const calls = vi.mocked(copyObject).mock.calls.map(([, from, to]) => [from, to]);
    // Archive first, promote second — the other order would overwrite the
    // live pair before it had been copied anywhere.
    expect(calls[0][0]).toBe("resume/current.pdf");
    expect(calls[0][1]).toMatch(/^resume\/archive\/.*\.pdf$/);
    expect(calls[1][0]).toBe("resume/current.json");
    expect(calls[1][1]).toMatch(/^resume\/archive\/.*\.json$/);
    expect(calls[2]).toEqual(["resume/drafts/abc/resume.pdf", "resume/current.pdf"]);
    expect(calls[3]).toEqual(["resume/drafts/abc/resume.json", "resume/current.json"]);
  });

  it("publishes with nothing to archive on the first publish", async () => {
    // This is a normal path, not an error — it is the state of production on
    // the day this ships.
    vi.mocked(objectExists).mockResolvedValue(false);

    const res = await POST(post({ draftId: "abc" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, archived: false });
    const calls = vi.mocked(copyObject).mock.calls.map(([, from, to]) => [from, to]);
    expect(calls).toEqual([
      ["resume/drafts/abc/resume.pdf", "resume/current.pdf"],
      ["resume/drafts/abc/resume.json", "resume/current.json"],
    ]);
  });

  it("revalidates the resume cache tag so the public pages update", async () => {
    await POST(post({ draftId: "abc" }));
    expect(revalidateTag).toHaveBeenCalledWith("resume");
  });

  it("rejects an unsafe draft id", async () => {
    const res = await POST(post({ draftId: "../current" }));
    expect(res.status).toBe(400);
    expect(copyObject).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run app/api/resume/publish/route.test.ts
```

Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement**

Create `app/app/api/resume/publish/route.ts`:

```ts
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { copyObject, objectExists } from "@/lib/aws";
import {
  CURRENT_JSON_KEY,
  CURRENT_PDF_KEY,
  archiveKeys,
  draftJsonKey,
  draftPdfKey,
  resumeBucket,
} from "@/lib/resume-keys";

export async function POST(request: Request) {
  // Application-level rather than IAM-level: all branches share one IAM user,
  // so the credentials retain the S3 permission everywhere. A second,
  // production-only key pair was considered and rejected as more machinery
  // than a single-user site behind a password gate justifies. See spec §7.3.
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { error: "publishing is only available on production" },
      { status: 403 },
    );
  }

  const { draftId } = await request.json();

  let pdfKey: string;
  let jsonKey: string;
  try {
    pdfKey = draftPdfKey(draftId);
    jsonKey = draftJsonKey(draftId);
  } catch {
    return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
  }

  const bucket = resumeBucket();

  // Archive before promoting. The reverse order would overwrite the live pair
  // before it had been copied anywhere.
  const archived = await objectExists(bucket, CURRENT_JSON_KEY);
  if (archived) {
    const target = archiveKeys();
    await copyObject(bucket, CURRENT_PDF_KEY, target.pdf);
    await copyObject(bucket, CURRENT_JSON_KEY, target.json);
  }

  await copyObject(bucket, pdfKey, CURRENT_PDF_KEY);
  await copyObject(bucket, jsonKey, CURRENT_JSON_KEY);

  revalidateTag("resume");
  return NextResponse.json({ ok: true, archived });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run app/api/resume/publish/route.test.ts
```

Expected: PASS, all five cases.

- [ ] **Step 5: Commit**

```bash
git add app/app/api/resume/publish/route.ts app/app/api/resume/publish/route.test.ts
git commit -m "feat(resume): add the publish route

Archives the live pair before promoting the draft over it, and refuses
to run outside production.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 10: The admin UI

One client component driving the four routes: pick a PDF → PUT it to the signed URL → extract → review the JSON in a textarea → publish.

**Files:**
- Create: `app/app/tools/resume-admin/page.tsx`

**Interfaces:**
- Consumes: all four routes from Tasks 5, 7, 8, 9
- Produces: the page at `/tools/resume-admin`

- [ ] **Step 1: Read the existing tool page for its conventions**

```bash
cd app && sed -n '1,80p' "app/tools/bgm-looper/page.tsx"
```

Match its shape: `"use client"`, a `Status` union, its own `<header>` masthead with the wordmark and `<CommandBar />` (the tool sits outside the `(site)` route group, so it does not inherit the site header), and Tailwind v4 tokens (`text-fg`, `text-muted`, `border-line`, `bg-accent`).

- [ ] **Step 2: Write the page**

Create `app/app/tools/resume-admin/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { CommandBar } from "../../../components/site/CommandBar";
import { resumeSchema } from "../../../lib/resume-schema";

type Status = "idle" | "uploading" | "extracting" | "review" | "publishing" | "done" | "error";

export default function ResumeAdminPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  // Validated as you type against the same schema the server enforces, so a
  // typo is caught before Publish rather than by a 422.
  function onJsonChange(next: string) {
    setJson(next);
    try {
      const parsed = resumeSchema.safeParse(JSON.parse(next));
      setSchemaError(parsed.success ? null : parsed.error.issues[0].message);
    } catch {
      setSchemaError("Not valid JSON");
    }
  }

  async function handleFile(file: File) {
    setError(null);
    try {
      setStatus("uploading");
      const urlRes = await fetch("/api/resume/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      });
      if (!urlRes.ok) {
        const { error: message } = await urlRes.json().catch(() => ({ error: null }));
        throw new Error(
          urlRes.status === 413
            ? "That PDF is over the 5 MB limit."
            : (message ?? "Could not start the upload."),
        );
      }
      const { draftId: id, uploadUrl } = await urlRes.json();

      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) throw new Error("The upload was rejected by storage.");

      setStatus("extracting");
      const extractRes = await fetch("/api/resume/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id }),
      });
      const extracted = await extractRes.json();
      if (!extractRes.ok) {
        throw new Error(extracted.error ?? "Extraction failed.");
      }

      setDraftId(id);
      setJson(JSON.stringify(extracted.resume, null, 2));
      setSchemaError(null);
      setStatus("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  async function save() {
    const res = await fetch("/api/resume/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId, resume: JSON.parse(json) }),
    });
    if (!res.ok) {
      setError("The server rejected those corrections.");
      setStatus("error");
    }
  }

  async function publish() {
    setStatus("publishing");
    await save();
    const res = await fetch("/api/resume/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId }),
    });
    if (!res.ok) {
      const { error: message } = await res.json().catch(() => ({ error: null }));
      setError(
        res.status === 403
          ? "Publishing only works on the production deployment. Open this page there with the same draft."
          : (message ?? "Publishing failed."),
      );
      setStatus("error");
      return;
    }
    setStatus("done");
  }

  return (
    <div className="flex min-h-screen flex-col font-ui">
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg"
        >
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Ashutosh Pandey
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
          Tools / Resume admin
        </span>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-6 px-5 py-14 sm:px-10">
        <div className="col-span-12 lg:col-span-5">
          <h1 className="font-display text-3xl leading-[1.15]">Publish a resume</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Upload a PDF, check what was read out of it, then publish. The PDF and
            the extracted JSON both go live; the previous pair is archived.
          </p>

          <label className="mt-8 block">
            <span className="sr-only">Resume PDF</span>
            <input
              type="file"
              accept="application/pdf"
              disabled={status === "uploading" || status === "extracting"}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              className="block w-full text-sm text-muted file:mr-4 file:border-0 file:bg-fg file:px-3 file:py-2 file:text-[0.6875rem] file:font-semibold file:uppercase file:tracking-[0.16em] file:text-bg"
            />
          </label>

          <p className="mt-6 text-xs uppercase tracking-[0.14em] text-muted">
            {status === "idle" && "Waiting for a file"}
            {status === "uploading" && "Uploading…"}
            {status === "extracting" && "Reading the PDF…"}
            {status === "review" && "Check the extraction"}
            {status === "publishing" && "Publishing…"}
            {status === "done" && <span className="text-accent">Published</span>}
            {status === "error" && <span className="text-peak">{error}</span>}
          </p>
        </div>

        {status !== "idle" && draftId && (
          <div className="col-span-12 lg:col-span-7">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs uppercase tracking-[0.14em] text-muted">
                Extracted content
              </h2>
              <Link
                href={`/tools/resume-admin/preview/${draftId}`}
                className="text-xs uppercase tracking-[0.14em] text-accent underline"
              >
                Preview →
              </Link>
            </div>

            <textarea
              value={json}
              onChange={(e) => onJsonChange(e.target.value)}
              spellCheck={false}
              rows={24}
              className="mt-4 w-full border border-line bg-transparent p-4 font-mono text-xs leading-relaxed"
            />

            {schemaError && <p className="mt-2 text-xs text-peak">{schemaError}</p>}

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={save}
                disabled={Boolean(schemaError)}
                className="min-h-11 border border-line px-4 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] disabled:opacity-40"
              >
                Save draft
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={Boolean(schemaError) || status === "publishing"}
                className="min-h-11 bg-fg px-4 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-bg disabled:opacity-40"
              >
                Publish
              </button>
            </div>
          </div>
        )}
      </main>

      <CommandBar />
    </div>
  );
}
```

- [ ] **Step 3: Verify it builds and typechecks**

```bash
cd app && npx tsc --noEmit && npm run lint
```

Expected: no errors.

`app/app/tools/resume-admin/page.tsx` sits at exactly the same depth as `app/app/tools/bgm-looper/page.tsx`, so the looper page's import paths are the reference: `../../../components/site/CommandBar` resolves to `app/components/site/CommandBar`, and `../../../lib/resume-schema` to `app/lib/resume-schema`. If either fails to resolve, check the depth against the looper page rather than guessing.

- [ ] **Step 4: Commit**

```bash
git add app/app/tools/resume-admin/page.tsx
git commit -m "feat(resume): add the resume admin page

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 11: The draft preview page

**Files:**
- Create: `app/app/tools/resume-admin/preview/[draftId]/page.tsx`

**Interfaces:**
- Consumes: `draftJsonKey`, `resumeBucket` (Task 2); `getObjectBytes` (Task 3); `resumeSchema` (Task 1)
- Produces: the page at `/tools/resume-admin/preview/<draftId>`

A cookie that made the public `/resume` render a draft was considered and rejected: it makes a public page's data source depend on a request cookie and defeats its caching (spec §7.2 step 4).

- [ ] **Step 1: Write the page**

Create `app/app/tools/resume-admin/preview/[draftId]/page.tsx`:

```tsx
import { getObjectBytes } from "../../../../../lib/aws";
import { draftJsonKey, resumeBucket } from "../../../../../lib/resume-keys";
import { resumeSchema } from "../../../../../lib/resume-schema";

// Always fresh: a draft changes on every save, and a cached preview showing
// the previous correction is worse than no preview.
export const dynamic = "force-dynamic";

export default async function DraftPreviewPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;

  let content;
  try {
    const bytes = await getObjectBytes(resumeBucket(), draftJsonKey(draftId));
    content = resumeSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    return (
      <main className="px-5 py-14 sm:px-10">
        <p className="text-sm text-peak">
          No readable draft for that id. Extract one first.
        </p>
      </main>
    );
  }

  return (
    <main className="px-5 py-14 sm:px-10">
      <p className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
        Preview — not published
      </p>
      <h1 className="mt-4 font-display text-4xl leading-[1.1]">
        {content.headline.name}
      </h1>
      <p className="mt-2 text-base text-muted">{content.headline.title}</p>
      <p className="mt-6 max-w-2xl text-base leading-relaxed text-fg/80">
        {content.headline.summary}
      </p>

      <ol className="mt-12">
        {content.work.map((entry) => (
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

      <dl className="mt-12 border-t border-line">
        {content.skills.map((group) => (
          <div
            key={group.group}
            className="grid grid-cols-12 gap-6 border-b border-line py-5"
          >
            <dt className="col-span-12 text-xs uppercase tracking-[0.14em] text-muted md:col-span-2">
              {group.group}
            </dt>
            <dd className="col-span-12 text-sm md:col-span-10">
              {group.items.join(" · ")}
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
```

- [ ] **Step 2: Verify it builds**

```bash
cd app && KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build
```

Expected: a successful build. Note `params` is a `Promise` in Next 16 and must be awaited — a synchronous `params.draftId` is a build-time type error.

- [ ] **Step 3: Commit**

```bash
git add "app/app/tools/resume-admin/preview/[draftId]/page.tsx"
git commit -m "feat(resume): add the draft preview page

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 12: End-to-end coverage, CHANGELOG, and the PR

**Files:**
- Create: `app/e2e/resume-admin.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 1-11
- Produces: merged Phase 2

- [ ] **Step 1: Write the spec**

Create `app/e2e/resume-admin.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("the resume admin page is behind the login gate", async ({ page }) => {
  await page.goto("/tools/resume-admin");
  await expect(page).toHaveURL(/\/login\?next=%2Ftools%2Fresume-admin/);
});

test("the gate names the resume admin as the destination", async ({ page }) => {
  await page.goto("/tools/resume-admin");
  await expect(page.getByText("Resume admin")).toBeVisible();
});

test("the resume API returns 401 rather than a redirect", async ({ request }) => {
  // proxy.ts returns a JSON 401 for /api/*, so a fetch from the page gets a
  // parseable error instead of the login page's HTML.
  const res = await request.post("/api/resume/extract", { data: { draftId: "abc" } });
  expect(res.status()).toBe(401);
});

test("signed in, the admin page offers a PDF picker", async ({ page }) => {
  await page.goto("/login?next=%2Ftools%2Fresume-admin");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /sign in|continue|unlock/i }).click();

  await expect(page).toHaveURL(/\/tools\/resume-admin/);
  await expect(page.locator('input[type="file"]')).toHaveAttribute(
    "accept",
    "application/pdf",
  );
});
```

If the gate's password field label or submit-button text differs, read `app/app/login/page.tsx` and match what is actually rendered rather than adjusting the page to fit the test.

- [ ] **Step 2: Run it**

```bash
cd app && npx playwright test e2e/resume-admin.spec.ts
```

Expected: PASS. If Chromium is missing, run `npx playwright install chromium` first.

- [ ] **Step 3: Run the whole gate**

```bash
cd app && npm test && npm run test:e2e && npm run lint && npx tsc --noEmit
```

Expected: all PASS. Note the e2e suite can flake on a cold server on the first run after a rebuild — re-run once before investigating, and only treat a failure as real if it repeats warm.

- [ ] **Step 4: Add the CHANGELOG entry**

Under `## [Unreleased]` in `CHANGELOG.md`, in the `### Added` section:

```markdown
- Resume admin pipeline at `/tools/resume-admin` (password-gated): upload a
  resume PDF, have it read by `anthropic/claude-haiku-4.5` via OpenRouter into
  a schema-validated JSON structure, correct anything that came out wrong in a
  live-validated editor, preview it, and publish. Publishing archives the
  previous `resume/current.{pdf,json}` under `resume/archive/<timestamp>` before
  promoting the draft, and revalidates the `resume` cache tag. Extraction is
  idempotent per draft so a page reload cannot spend another model call, and
  publishing is refused outside the production deployment — drafts stay
  writable on every branch so one reviewed on `dev` can be published from
  production unchanged.
```

- [ ] **Step 5: Commit and open the PR**

```bash
git add app/e2e/resume-admin.spec.ts CHANGELOG.md
git commit -m "test(e2e): cover the resume admin gate

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin <branch>
```

Open the PR against `dev` with `gh pr create --base dev --body-file <file>`, following `.github/pull_request_template.md`. Do not use a `$(cat <<'EOF' …)` heredoc — write the body to a file first.

- [ ] **Step 6: Merge per the standing sequence**

Green `test`, then `aws-devops-agent/release-readiness-review` reporting `change approved` via the **commit status** API (`gh api repos/DataCrusade1999/supreme-enigma/commits/<sha>/status`), then **read the inline comments** (`gh api --paginate repos/DataCrusade1999/supreme-enigma/pulls/<N>/comments`) and act on or reply to each, then `gh pr merge <N> --squash --delete-branch`, then `git checkout dev && git pull --ff-only origin dev`.

Verify the agent's *suggested fixes* against the docs before applying them — on Phase 1 two of its suggestions were wrong in ways that would have caused real damage. Its problem reports were accurate both times.

- [ ] **Step 7: Exercise the real pipeline once**

Unit tests mock S3 and OpenRouter, so nothing so far has proven the whole path works against the real services.

On the `dev` preview, sign in, upload the real resume PDF, and confirm: the extraction returns sensible content, correcting the JSON and saving succeeds, the preview renders it, and **Publish returns 403** (this is `dev` — the refusal is the correct behavior). Then open the production deployment's admin page, confirm the same draft is reachable, and publish there.

After publishing, verify the objects landed:

```bash
aws s3 ls s3://bgm-looper-audio-223376380711/resume/ --recursive \
  --profile personal --region us-east-1
```

Expected: `resume/current.pdf`, `resume/current.json`, the draft pair, and — on a second publish — an `resume/archive/<timestamp>` pair.

---

## Phase 3

`docs/superpowers/plans/2026-09-13-resume-pipeline-phase-3.md` — the public rendering half: the cached S3 read with a placeholder fallback, the resume page timeline and skills section, the About page headline and summary, and the `/resume.pdf` route handler. It consumes `resumeSchema`, `CURRENT_JSON_KEY`, `CURRENT_PDF_KEY`, `resumeBucket`, `getObjectBytes`, `objectExists` and `presignDownloadFrom` from this phase, so Phase 2 lands first.
