# Resume Pipeline — Design

**Date:** 2026-09-05
**Status:** Approved, ready for planning
**Branch:** `feat/resume-pipeline`

## 1. Problem

The portfolio's resume story is currently a stub:

- `app/content/resume.ts` holds placeholder data ("Add your most recent role here").
- `app/app/(site)/resume/page.tsx:12` links to `/resume.pdf`, but **there is no `app/public/` directory** — the Download PDF button is a dead link in production today.
- The About page (`app/app/(site)/about/page.tsx`) is bracketed scaffold copy.

Updating any of it means editing TypeScript and redeploying. The goal is to upload a resume PDF through the site, have the structured content derived from it automatically, review that content before it goes live, and have both the PDF download and the rendered pages served from that single upload.

## 2. Goals and non-goals

**Goals**

- Store the resume PDF in S3 with prefix-scoped lifecycle rules, durable rather than expiring.
- Upload it through an authenticated page on the portfolio site — no AWS console, no redeploy.
- Derive structured JSON (headline, work history, skills) from the PDF via Amazon Bedrock.
- Review and correct the extraction before publishing.
- Preview on `dev`/`stage`; publish only from production.
- Render the resume and About pages from the published JSON, and make the PDF download work.
- Keep AWS cost negligible and IAM least-privilege.
- Close the pre-existing gaps that stand between "the public cannot upload" and "only I can upload"
  (see §11), before the bucket holds anything worth keeping.

**Non-goals**

- Multi-user auth or roles. The existing single shared-password gate is the whole security model.
- Editing the PDF itself, or generating a PDF from the JSON.
- Replacing Keystatic for blog content. This is a separate, non-git content path.
- Education/certifications extraction (explicitly deferred — see §14).

## 3. Decisions

| Question | Decision |
|---|---|
| Source of truth | PDF is the artifact; extracted JSON drives the pages; the JSON is reviewed before going live |
| Extraction | Amazon Bedrock, model chosen by measured cost/quality, not fixed to a vendor |
| Bucket | Reuse `main`'s existing audio bucket for all branches; no new bucket |
| Bucket versioning | **No** — history via an `archive/` prefix instead (see §4.2) |
| Render path | Server-render from S3 through a cached read, revalidated on publish |
| Publish scope | Production only, enforced by an app-level guard |
| Review UX | Validated JSON textarea with a live preview, not a per-field form |

## 4. Storage

### 4.1 Bucket

All three branches read and write **`bgm-looper-audio-<account>`** (main's bucket) for resume data. The `dev` and `stage` twins keep serving audio only.

Rationale: one resume, uploaded once, visible on every environment. The alternative — a `resume/` prefix in each per-branch bucket — would mean uploading three times and having dev show a different resume than production.

A new **`RESUME_BUCKET_NAME`** env var carries main's bucket name. It is environment-agnostic, so per CLAUDE.md's split it belongs in `infra/main/shared.tf` alongside `APP_PASSWORD`, **not** in `environments.tf` with the per-branch `S3_BUCKET_NAME` overrides.

### 4.2 Key layout and lifecycle

| Prefix / key | Contents | Expiry |
|---|---|---|
| `uploads/` | audio input (existing) | 1 day |
| `outputs/` | audio output (existing) | 1 day |
| `resume/drafts/<uuid>/resume.pdf` | uploaded PDF, under review | 1 day |
| `resume/drafts/<uuid>/resume.json` | extracted JSON, under review | 1 day |
| `resume/current.pdf` | live PDF | never |
| `resume/current.json` | live structured content | never |
| `resume/archive/<ISO8601>.pdf` | previous live PDF | 365 days |
| `resume/archive/<ISO8601>.json` | previous live JSON | 365 days |

The single blanket rule at `infra/main/environments.tf:32-43` (`filter {}` + `expiration.days = 1`) is replaced by four prefix-scoped rules. The same four are applied to all three buckets so the configuration stays identical across environments, even though only main's holds resume data.

**Bucket versioning is deliberately not enabled.** It is the obvious way to keep resume history and it would silently break the audio cost model: with versioning on, `expiration.days = 1` on `uploads/`/`outputs/` writes a delete marker rather than deleting, so every processed audio file persists as a noncurrent version indefinitely unless every rule also carries `noncurrent_version_expiration`. The `resume/archive/` prefix provides history without that interaction, and is itself the "prefix-level lifecycle rules" the feature asked for.

## 5. Extraction

### 5.1 Verified account state — both candidate models are blocked today

Probed live against account `223376380711` in `us-east-1` on 2026-09-05:

- **`amazon.nova-lite-v1:0`** — supports `ON_DEMAND`. A minimal Converse call returned
  `ThrottlingException: Too many tokens per day, please wait before trying again.`
  Access is granted (the call reached a quota error, not an authorization error), but the account is
  under a daily token ceiling that was already exhausted.
- **`anthropic.claude-haiku-4-5-20251001-v1:0`** — `inferenceTypesSupported: ["INFERENCE_PROFILE"]`
  only, so it **must** be invoked via the profile id
  `us.anthropic.claude-haiku-4-5-20251001-v1:0`
  (`arn:aws:bedrock:us-east-1:223376380711:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`).
  A minimal Converse call returned
  `ResourceNotFoundException: Model use case details have not been submitted for this account.`

**Both are one-time manual console prerequisites that Terraform cannot perform.** Phase 1 must resolve
them and re-run the probe before any extraction code is written:

1. Submit the Anthropic use-case details form in the Bedrock console (unblocks Claude models).
2. Confirm the Nova Lite daily token quota, and request an increase via Service Quotas if the ceiling
   is too low for occasional extraction.

If neither can be unblocked, the fallback is deterministic PDF parsing with manual correction in the
review step — the review UI makes that degradation tolerable rather than fatal.

### 5.2 Model choice

The model is **not fixed to a vendor**. `BEDROCK_MODEL_ID` is a Terraform-managed Vercel env var, so
switching is a config change, not a code change. Selection procedure, in order:

1. Try `amazon.nova-lite-v1:0` against the real resume PDF once its quota is confirmed.
2. Judge the output by whether the review step needs substantive correction.
3. Escalate to `us.anthropic.claude-haiku-4-5-20251001-v1:0` only if Nova Lite's extraction is
   materially worse.

Indicative cost for a 2-page resume (~3-4k input, ~1.5k output tokens): Nova Lite ≈ $0.0006/run
(₹0.06), Claude Haiku 4.5 ≈ $0.011/run (₹1). At a dozen extractions a year the feature costs between
₹1 and ₹12 annually. See §9 for the measured account baseline this sits against.

### 5.3 Mechanism

Bedrock's **Converse API `document` content block** accepts `format: "pdf"` and a
`source.s3Location.uri`, so the PDF is passed **by S3 reference** — the route never downloads the
bytes, and no PDF-parsing dependency is added to the app. The block also accepts `bucketOwner`, which
is set explicitly.

The model is prompted for JSON matching the §6 schema, and its response is parsed and validated with
zod. A validation failure surfaces in the review UI as an error with the raw response shown, rather
than writing malformed JSON to S3.

`ConverseStream` is not used — the response is small and nothing consumes it incrementally. This keeps
`bedrock:InvokeModelWithResponseStream` out of the IAM policy.

## 6. Schema

`app/lib/resume-schema.ts`, a zod schema that is the single source of truth for the Bedrock output
contract, the review-step validation, and the page props.

```ts
{
  headline: { name: string, title: string, summary: string },
  work: [{ role: string, org: string, start: string, end: string, bullets: string[] }],
  skills: [{ group: string, items: string[] }]
}
```

- `work` supersedes the placeholder shape in `app/content/resume.ts` and matches the existing
  `ResumeEntry` fields, so the resume page's timeline markup is reused as-is.
- `headline` drives the About page intro and page metadata.
- `skills` is a new section on the resume page.

## 7. Application flow

### 7.1 Route gating

`/tools/resume-admin` and `/api/resume` are added to `GATED_PREFIXES` in `app/lib/route-gate.ts`.
`app/proxy.ts` needs no change: it already redirects unauthenticated page requests to
`/tools/bgm-looper/login` with `?next=<path>`, and already returns a 401 JSON body for `/api/*`.

### 7.2 Steps

1. **Upload** — `POST /api/resume/upload-url` returns a presigned PUT to
   `resume/drafts/<uuid>/resume.pdf`. This needs a **new key helper**; reusing `keyForUpload` from
   `app/lib/aws.ts` would write to `uploads/` and expire the PDF within a day.
2. **Extract** — `POST /api/resume/extract` invokes Bedrock against the draft's S3 URI, validates the
   response, and writes `resume/drafts/<uuid>/resume.json`. The route sets an explicit `maxDuration`;
   extraction can exceed Vercel's default function timeout.
3. **Review** — the admin page shows the JSON in a textarea validated against the schema on change,
   with a live preview beside it. Corrections are saved back to the draft's `resume.json` via
   `PUT /api/resume/draft`, which re-validates server-side before writing.
   A per-field form was considered and rejected as more UI than a twice-a-year task justifies.
4. **Preview** — `/tools/resume-admin/preview/<draftId>` renders the real resume and About components
   with the draft JSON passed as a prop. A cookie that made the public `/resume` and `/about` render a
   draft was rejected: it makes public pages' data source depend on a request cookie and defeats their
   caching.
5. **Publish** — `POST /api/resume/publish` copies the existing `resume/current.{pdf,json}` to
   `resume/archive/<ISO8601>.{pdf,json}`, copies the draft over `resume/current.{pdf,json}`, then
   revalidates the cache tag. On first publish there is nothing to archive; that is a normal path, not
   an error.

### 7.3 Publish is production-only

The publish route returns **403 unless `process.env.VERCEL_ENV === "production"`**.

Drafts remain writable from every branch, which is what makes preview-then-promote work: upload and
review on `dev`, then open the production admin, where the same draft appears (same bucket, same
prefix), and publish there. Nothing is redone to promote a draft — only the URL differs.

The guard is application-level, not IAM-level: all branches share one IAM user, so the shared
credentials retain the S3 permission. This was chosen deliberately over provisioning a second,
production-only IAM user. On a single-user site behind a shared password gate, the marginal security
of credential-level enforcement did not justify a second key pair, a second S3 client, and a publish
path that could never be exercised outside production.

## 8. Public rendering

`/resume` and `/about` become server components reading `resume/current.json` from S3.

**Caching:** the project runs Next 16.3.3 with an empty `next.config.mjs`, so the `cacheComponents`
flag is off and the `"use cache"` directive is unavailable. The read is wrapped in `unstable_cache`
with a `resume` tag; the publish route calls `revalidateTag("resume")`. Enabling `cacheComponents` to
use `"use cache"` is out of scope — it is a repo-wide rendering behavior change far beyond this
feature.

**Missing-object fallback:** before the first publish, `resume/current.json` does not exist. Both
pages must render the existing placeholder content in that case rather than erroring. This is a tested
path, not a theoretical one — it is the state of production on the day phase 3 ships.

**PDF download:** `/resume.pdf` becomes a route handler that redirects to a 300s presigned GET of
`resume/current.pdf`, matching the existing presign expiry in `app/lib/aws.ts`. Before the first
publish it returns 404. This fixes the currently-dead download link.

## 9. Cost

Measured baseline for account `223376380711` (`personal` profile), at USD/INR ≈ 94.43:

| Month | Total | Largest lines |
|---|---|---|
| Jul 2026 | $0.11 (₹10) | ECR $0.031, Cost Explorer $0.06 |
| Aug 2026 | $0.28 (₹26) | ECR $0.215, Cost Explorer $0.09 |
| Sep 2026 (4 days) | $0.09 (₹9) | ECR $0.024, Cost Explorer $0.06 |

Already in place: a **$20/month account budget** ("My Monthly Cost Budget", forecast $0.34) and the
default Cost Explorer anomaly monitor.

Incidental finding, not addressed by this work: **Cost Explorer API calls are 25-30% of the monthly
bill** — each `GetCostAndUsage` costs $0.01, so querying the bill currently costs more than running
the application. Worth knowing before adding automated cost polling anywhere.

This feature's own cost: Bedrock on-demand has no idle charge, S3 storage for `resume/` is well under
1 MB, and page reads are cached. Total expected impact is **₹1-₹12 per year**.

### 9.1 Runaway guardrails

The per-call price is negligible; the real exposure is an unbounded loop. Four controls:

1. **`maxTokens` capped at 4000** on the Converse call, bounding worst-case cost per invocation.
2. **PDF size capped at 5 MB, enforced inside the signature** — see §11.3. Checking the size after the
   object lands means the oversized upload has already been paid for.
3. **Extraction is idempotent per draft.** If `resume.json` already exists for that draft ID it is
   returned as-is; re-extraction requires an explicit force flag. A refresh loop cannot generate
   repeated model calls.
4. **A project-scoped monthly budget** (`bgm-looper-monthly-cap`) added in Terraform with SNS email
   alerts at 80% and 100%. A `magma-learning` project budget already exists and is the pattern to
   follow; this project currently has none.

## 10. IAM — least privilege

The Vercel service-account policy at `infra/main/shared.tf:133-152` currently grants
`s3:PutObject, s3:GetObject` on `<bucket>/*` for all three buckets — broader than required even before
this feature. It is tightened as part of this work:

- S3 actions scoped to explicit prefixes — `uploads/*`, `outputs/*` on all three buckets, and
  `resume/*` on main's — rather than `/*`.
- `s3:DeleteObject` added on `resume/drafts/*` only, for draft cleanup.
- `bedrock:InvokeModel` scoped to the specific model ARN and, where the model requires one, its
  inference profile ARN. Never `*`.
- `bedrock:InvokeModelWithResponseStream` deliberately omitted — the design does not stream.

Because this modifies an existing policy, the infra PR's acceptance criterion is that
`terraform plan` (run in a scratch worktree against real state, per CLAUDE.md) shows **exactly the
intended adds and changes** — not `No changes.`

## 11. Security hardening

### 11.0 Verified starting state

Checked live against `bgm-looper-audio-223376380711` on 2026-09-05:

- Public access block: `BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`,
  `RestrictPublicBuckets` all `true`.
- No bucket policy (`NoSuchBucketPolicy`) — nothing grants anonymous access.
- ACL: owner `FULL_CONTROL` only, no other grantees.
- Uploads occur solely through presigned PUTs issued by `/api/looper/upload-url`, which is gated by
  the `/api/looper` prefix in `GATED_PREFIXES`.

**There is no path for an anonymous member of the public to write to the bucket, and the `resume/`
prefix inherits that.** The four items below are the gaps between that and the stronger claim the
feature actually depends on — that *only the owner* can upload. All four are pre-existing; none is
introduced by this feature. They are in scope because the resume is the first thing stored here that
is worth keeping, rather than a scratch audio file that expires in a day.

### 11.1 Rate-limit `/api/login`

`app/app/api/login/route.ts` accepts unlimited password attempts at any rate. `APP_PASSWORD` is a
single static string, so this is the single point of failure for the entire "only I can upload"
guarantee — every other control below assumes the password holds.

Add per-IP attempt limiting with a lockout window. This is the highest-priority item in the spec.

### 11.2 Give the session cookie a real expiry

`createSessionCookieValue` in `app/lib/auth.ts` signs the constant payload `"authenticated"`, so the
cookie value is byte-identical on every login and carries no timestamp. Consequences:

- The `maxAge: 60 * 60 * 24 * 7` set in the login route is a browser-side hint only. A copied cookie
  remains valid indefinitely, until `COOKIE_SECRET` is rotated.
- There is no way to revoke a single session.

Fix: include an issued-at timestamp in the signed payload and reject expired values in
`verifySessionCookieValue`. Rotating `COOKIE_SECRET` remains the "log everyone out" lever.

While in this file, fix the length-based early return in `checkPassword`: it returns before reaching
`timingSafeEqual` when lengths differ, leaking the password length through timing. The intent to be
constant-time is already there; the guard undoes it.

### 11.3 Enforce the upload size limit in the signature

`presignUpload` signs only `Bucket`, `Key`, and `ContentType`. A signed URL therefore authorizes an
object of *any* size, up to S3's 5 GB single-PUT ceiling.

Fix: bind the limit into the signature — either `ContentLength` on the `PutObjectCommand`, or a
presigned POST carrying a `content-length-range` condition. This is what makes §9.1's 5 MB cap real
rather than advisory. Applies to the audio upload path as well as the new resume one.

### 11.4 Scope CORS, and add an account-level public access block

`aws_s3_bucket_cors_configuration.audio` (`infra/main/environments.tf:22-29`) sets
`allowed_origins = ["*"]`. This is not an authorization hole — CORS does not grant permission, the
signature does — but it should be the three known deployment origins.

Separately, `GetPublicAccessBlock` at the **account** level returns
`NoSuchPublicAccessBlockConfiguration`. The bucket-level blocks cover today's buckets; the
account-level one is a cheap backstop preventing a future bucket from being created public by
accident.

## 12. Testing

**Vitest** (S3 and Bedrock mocked):

- Schema validation: valid payload, missing field, wrong type, malformed model output.
- Key helpers: draft, current, and archive key construction; confirmation that resume keys never land
  under `uploads/`.
- Publish guard: 403 when `VERCEL_ENV` is not `production`, success when it is.
- Publish archive step: archives an existing current pair; succeeds with nothing to archive.
- Extraction idempotency: an existing draft `resume.json` short-circuits the model call.
- Size cap: the presigned URL is signed with the 5 MB constraint, not merely checked afterward.
- Missing-object fallback: both pages render placeholder content when `resume/current.json` is absent.
- Route gate: `/tools/resume-admin` and `/api/resume/*` are gated; existing paths unaffected.

Security (§11):

- Login rate limiting: attempts beyond the threshold are rejected; the window resets as specified.
- `checkPassword` is constant-time for a wrong password of a *different* length, not just an equal one.
- Session cookie: a value with an expired issued-at timestamp is rejected; a fresh one is accepted;
  a value signed with a different secret is rejected.

**Playwright:** unauthenticated `/tools/resume-admin` redirects to the login page with the correct
`?next=`; authenticated, the admin page renders its upload control.

Both runners are the CI gate — `cd app && npm test` covers only Vitest (see CLAUDE.md).

## 13. Implementation phases

Each phase is independently shippable and lands as its own PR into `dev`.

**Phase 1 — Infrastructure and hardening.** Nothing in the resume pipeline is built until this ships.

- Unblock the Bedrock prerequisites in the console (§5.1) and re-probe.
- Split the lifecycle rule into four prefix-scoped rules across all three buckets (§4.2).
- Add `RESUME_BUCKET_NAME` and `BEDROCK_MODEL_ID` to `shared.tf` (§4.1).
- Tighten the Vercel IAM policy to least privilege (§10).
- Add the `bgm-looper-monthly-cap` budget with SNS alerts (§9.1).
- All four hardening items: login rate limiting, session cookie expiry plus the `checkPassword`
  timing fix, signature-bound upload size limit, scoped CORS, and the account-level public access
  block (§11).
- Verify with `terraform plan` in a scratch worktree.

This phase is valuable on its own even if the resume work stopped here: it fixes an over-broad IAM
policy, adds a missing budget, and closes an unrate-limited login. Its size makes it a candidate for
splitting into two PRs (infra, then hardening) — either way, both land before Phase 2 starts.

**Phase 2 — Admin pipeline.** Schema, key helpers, the four API routes, the gate entries, and the
admin UI with review and preview.

**Phase 3 — Public rendering.** Cached S3 read with the placeholder fallback, resume page timeline and
new skills section, About page headline and summary, and the `/resume.pdf` route handler.

`CHANGELOG.md` gets an `## [Unreleased]` entry in each PR, per CLAUDE.md.

## 14. Open items

- Nova Lite's actual extraction quality on the real PDF is unmeasured; §5.2 defines the escalation
  path if it is inadequate.
- The Nova Lite daily token quota ceiling is unknown and may need a Service Quotas increase.
- Education and certifications are deferred. Adding them later is a schema extension plus one render
  block, with no change to the pipeline.
