# Resume Pipeline Phase 1 — Infrastructure and Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the S3 bucket, IAM, cost controls, and application auth so the resume pipeline has a safe, least-privilege, owner-only foundation to be built on.

**Architecture:** A throwaway spike (Task 1) that validates the OpenRouter extraction path, then two independent workstreams landing as two PRs into `dev`. The Terraform stream replaces the audio bucket's blanket lifecycle rule with prefix-scoped rules, scopes IAM and CORS down to least privilege, and adds a project budget. The application stream closes four auth and upload gaps in `app/lib/`. Neither stream depends on the other; both must land before Phase 2 begins.

**Tech Stack:** Terraform (AWS + Vercel providers), Next.js 16.3.3, TypeScript, Vitest, Playwright, AWS SDK v3.

**Spec:** `docs/superpowers/specs/2026-09-05-resume-pipeline-design.md`

## Global Constraints

- Every manual `aws` CLI command passes **both** `--profile personal` and `--region us-east-1`. Omitting the region silently queries `ap-south-1` and returns a misleading `ResourceNotFoundException`.
- AWS account is `223376380711`. Main's bucket is `bgm-looper-audio-223376380711`.
- Terraform runs from `infra/main/` with `-var-file=terraform.tfvars`.
- There is **no Terraform validation in CI** — no `validate`, no `fmt -check`, no `plan`. Any PR touching `infra/` must be verified with a manual `terraform plan` against real state before merge.
- App unit tests: `cd app && npm test` (Vitest only). CI's `test` job runs Vitest **and** Playwright and fails if either fails.
- App lint: `cd app && npm run lint`.
- Node/TS style: match surrounding code. The repo uses named exports from `app/lib/*.ts` with a colocated `*.test.ts`.
- Branch is `feat/resume-pipeline`, cut from `dev`. PRs target `dev`.
- Commit messages end with: `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`
- Add a `CHANGELOG.md` entry under `## [Unreleased]` in each PR.
- Do not enable S3 bucket versioning (spec §4.2 — it breaks the audio 1-day expiry).
- **The OpenRouter API key never enters the repo.** It lives in the gitignored `infra/main/terraform.tfvars` and, for the Task 1 probe, in a shell env var only. Never write it into a committed file, a code comment, a test fixture, or a commit message.

## File Structure

**Terraform stream** (`infra/main/`)

| File | Responsibility | Change |
|---|---|---|
| `environments.tf` | per-branch buckets, lifecycle, CORS, Lambdas | Modify: replace lifecycle rules, scope CORS |
| `shared.tf` | one-of-each resources, IAM, Vercel env vars | Modify: IAM policy; add env vars, budget, SNS, account PAB |
| `variables.tf` | input variables | Modify: add `alert_email`, `openrouter_api_key`, `openrouter_model` |
| `terraform.tfvars` | gitignored secrets | Modify: add `alert_email` and `openrouter_api_key` (local only) |

**Application stream** (`app/`)

| File | Responsibility | Change |
|---|---|---|
| `lib/auth.ts` | password check, session cookie sign/verify | Modify: constant-time compare, timestamped cookie |
| `lib/auth.test.ts` | tests for the above | Modify |
| `lib/rate-limit.ts` | in-memory fixed-window rate limiter | **Create** |
| `lib/rate-limit.test.ts` | tests for the above | **Create** |
| `lib/aws.ts` | S3 client, keys, presigning | Modify: `presignUpload` takes a signed byte length |
| `lib/aws.test.ts` | tests for the above | Modify |
| `app/api/login/route.ts` | login handler | Modify: apply rate limit |
| `app/api/looper/upload-url/route.ts` | presign handler | Modify: validate and pass size |
| `app/tools/bgm-looper/page.tsx` | audio upload client | Modify: send `file.size` |

`rate-limit.ts` is a separate file rather than living in `auth.ts` because it is transport-level concern with different state semantics (mutable module state) and will later be reused by `/api/resume/extract`.

---

## Task 1: Verify the OpenRouter path end to end

A spike, not a gate. Bedrock is blocked account-wide (spec §5.1) and extraction moved to
OpenRouter, which unblocks planning Phase 2 — but three assumptions are unverified: that the key
works, that `anthropic/claude-haiku-4.5` accepts a PDF through the `file-parser` plugin, and that
`response_format: json_schema` returns schema-valid output. Find out before building on them.

**Files:**
- Create: `<scratchpad>/openrouter-probe.mjs` (throwaway — do not commit)

**Interfaces:**
- Consumes: nothing
- Produces: confirmation of the model slug and request shape used by Phase 2's extract route

- [ ] **Step 1: Confirm the key is available**

The key is the user's; it is not in the repo. Ask for it and export it in the shell for this probe
only — do not write it to a file, and do not commit it anywhere.

```bash
export OPENROUTER_API_KEY='<the key>'
```

- [ ] **Step 2: Confirm the key authenticates and has credit**

```bash
curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer $OPENROUTER_API_KEY"
```

Expected: JSON with `data.limit_remaining` non-zero (or `null`, meaning no cap). A 401 means the
key is wrong or revoked — stop and resolve that before continuing.

- [ ] **Step 3: Probe with a real resume PDF**

Write this to the scratchpad directory (not the repo) and run it with a real PDF path.

```javascript
// Throwaway probe. Confirms: PDF file input, the file-parser native engine, and
// json_schema structured outputs all work together on this model.
import { readFile } from "node:fs/promises";

const pdfPath = process.argv[2];
const b64 = (await readFile(pdfPath)).toString("base64");

const schema = {
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
};

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "anthropic/claude-haiku-4.5",
    max_tokens: 4000,
    plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "resume", strict: true, schema },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Extract this resume into the required JSON schema. Use the exact wording from " +
              "the document for bullets. For a current role, use \"Present\" as the end value.",
          },
          {
            type: "file",
            file: {
              filename: "resume.pdf",
              file_data: `data:application/pdf;base64,${b64}`,
            },
          },
        ],
      },
    ],
  }),
});

const json = await res.json();
console.log("status:", res.status);
console.log("usage:", JSON.stringify(json.usage, null, 2));
console.log("content:", json.choices?.[0]?.message?.content);
console.log("error:", JSON.stringify(json.error ?? null));
```

Run it:

```bash
node <scratchpad>/openrouter-probe.mjs /path/to/your/resume.pdf
```

- [ ] **Step 4: Judge the result**

Check all four:

1. `status: 200`.
2. `content` parses as JSON and matches the schema shape.
3. The extracted content is actually right — real job titles, real dates, bullets that appear in
   the document. Structured-output validity is not accuracy; read it.
4. `usage.cost` is in the expected range (roughly $0.01). A much larger number means the `native`
   engine is charging more page tokens than estimated — note the real figure.

If accuracy is poor, try `anthropic/claude-sonnet-4.5` and compare before changing the plan; the
model is an env var, so this is a config decision, not a code one.

- [ ] **Step 5: Record the outcome in the spec**

Update §5.2 with the measured per-run cost and the model that passed, and close the first item in
§14. If something did not work, write down what — a wrong assumption recorded is worth more than
a plan that pretends it held.

- [ ] **Step 6: Delete the probe**

```bash
rm <scratchpad>/openrouter-probe.mjs
```

It is throwaway by design — the real implementation lives in Phase 2's extract route. Confirm no
key was written into any file: `git status` must be clean apart from the spec edit.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-09-05-resume-pipeline-design.md
git commit -m "docs(spec): record verified OpenRouter extraction path

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 2: Prefix-scoped S3 lifecycle rules

Replaces the blanket `filter {}` + 1-day rule that would delete the resume within a day of upload.

**Files:**
- Modify: `infra/main/environments.tf:32-43` (rule for `aws_s3_bucket.audio`)
- Modify: `infra/main/environments.tf:70-82` (rule for `aws_s3_bucket.audio_env`)

**Interfaces:**
- Consumes: nothing
- Produces: the `resume/` prefixes described in spec §4.2, relied on by Tasks 4 and 6 and by Phase 2

- [ ] **Step 1: Replace main's lifecycle configuration**

Replace the whole `aws_s3_bucket_lifecycle_configuration.audio` resource with:

```hcl
# Prefix-scoped rather than a blanket filter: audio is scratch and expires in a day,
# but resume/current.* must persist indefinitely. Bucket versioning is deliberately NOT
# enabled — with versioning on, these expiration rules would only write delete markers
# and every audio object would linger as a noncurrent version. See the design spec §4.2.
resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    id     = "expire-audio-uploads"
    status = "Enabled"
    filter { prefix = "uploads/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-audio-outputs"
    status = "Enabled"
    filter { prefix = "outputs/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-resume-drafts"
    status = "Enabled"
    filter { prefix = "resume/drafts/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-resume-archive"
    status = "Enabled"
    filter { prefix = "resume/archive/" }
    expiration { days = 365 }
  }
}
```

There is deliberately **no** rule matching `resume/current.pdf` or `resume/current.json` — absence of a rule is what makes them permanent.

- [ ] **Step 2: Replace the dev/stage lifecycle configuration**

Replace `aws_s3_bucket_lifecycle_configuration.audio_env` with the same four rules. Only main's bucket holds resume data, but keeping the configuration identical avoids a confusing diff between environments.

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "audio_env" {
  for_each = aws_s3_bucket.audio_env
  bucket   = each.value.id

  rule {
    id     = "expire-audio-uploads"
    status = "Enabled"
    filter { prefix = "uploads/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-audio-outputs"
    status = "Enabled"
    filter { prefix = "outputs/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-resume-drafts"
    status = "Enabled"
    filter { prefix = "resume/drafts/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-resume-archive"
    status = "Enabled"
    filter { prefix = "resume/archive/" }
    expiration { days = 365 }
  }
}
```

- [ ] **Step 3: Format and validate**

```bash
cd infra/main && terraform fmt && terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
git add infra/main/environments.tf
git commit -m "feat(infra): scope S3 lifecycle rules to prefixes

The single blanket rule expired everything in the bucket after a day,
which would delete a stored resume. Splits it into per-prefix rules and
leaves resume/current.* with no expiry.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 3: Scope CORS and add an account-level public access block

**Files:**
- Modify: `infra/main/environments.tf:22-29` (`aws_s3_bucket_cors_configuration.audio`)
- Modify: `infra/main/shared.tf` (append the account PAB)

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Scope the CORS origins**

The bucket currently allows `["*"]`. Replace `aws_s3_bucket_cors_configuration.audio` with:

```hcl
locals {
  # The three deployment origins that issue presigned-URL uploads. Wildcard origins were
  # not an authorization hole (the signature grants access, not CORS) but there is no
  # reason for any other site's JS to be able to read these responses.
  app_origins = [
    "https://bgm-looper.vercel.app",
    "https://bgm-looper-git-stage-ashutosh-pandeys-projects-77cb3a00.vercel.app",
    "https://bgm-looper-git-dev-ashutosh-pandeys-projects-77cb3a00.vercel.app",
    "http://localhost:3000",
  ]
}

resource "aws_s3_bucket_cors_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = local.app_origins
    allowed_headers = ["*"]
  }
}
```

Place the `locals` block next to the existing `locals` in `environments.tf`, or merge it into that block if one already exists in the file.

- [ ] **Step 2: Apply the same to dev/stage**

`aws_s3_bucket_cors_configuration.audio_env` already exists at `environments.tf:59-68` with the same `["*"]` origins. Change its `allowed_origins` line only:

```hcl
resource "aws_s3_bucket_cors_configuration" "audio_env" {
  for_each = aws_s3_bucket.audio_env
  bucket   = each.value.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = local.app_origins
    allowed_headers = ["*"]
  }
}
```

- [ ] **Step 3: Add the account-level public access block**

`GetPublicAccessBlock` at the account level currently returns `NoSuchPublicAccessBlockConfiguration`. Append to `shared.tf`:

```hcl
# Account-wide backstop. The per-bucket blocks already cover today's buckets; this
# prevents a future bucket from being created publicly accessible by accident.
resource "aws_s3_account_public_access_block" "account" {
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

- [ ] **Step 4: Format and validate**

```bash
cd infra/main && terraform fmt && terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
git add infra/main/environments.tf infra/main/shared.tf
git commit -m "feat(infra): scope bucket CORS to app origins, add account PAB

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 4: Tighten the Vercel IAM policy to least privilege

The policy at `shared.tf:133-152` grants `s3:PutObject, s3:GetObject` on `<bucket>/*` for all three buckets — broader than needed even before this feature.

**Files:**
- Modify: `infra/main/shared.tf:133-152` (`aws_iam_user_policy.vercel`)

**Interfaces:**
- Consumes: the `resume/` prefixes from Task 2
- Produces: the S3 permissions the Phase 2 routes rely on

- [ ] **Step 1: Replace the policy**

```hcl
locals {
  # Only main's bucket holds resume data — dev/stage read and write it too, via the
  # env-agnostic RESUME_BUCKET_NAME. See the design spec §4.1.
  resume_bucket_arn = aws_s3_bucket.audio.arn
}

resource "aws_iam_user_policy" "vercel" {
  name = "${var.project_name}-vercel-policy"
  user = aws_iam_user.vercel.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AudioScratchObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = flatten([
          for arn in local.all_audio_bucket_arns : ["${arn}/uploads/*", "${arn}/outputs/*"]
        ])
      },
      {
        Sid      = "ResumeObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${local.resume_bucket_arn}/resume/*"]
      },
      {
        Sid      = "ResumeDraftCleanup"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject"]
        Resource = ["${local.resume_bucket_arn}/resume/drafts/*"]
      },
      {
        Sid      = "InvokeProcessor"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = local.all_lambda_function_arns
      }
    ]
  })
}
```

**No Bedrock statement.** Extraction moved to OpenRouter (spec §5.1-5.2), so the app's AWS credentials grant nothing beyond scoped S3 and the existing Lambda invoke — strictly less privilege than the Bedrock design needed. The OpenRouter key is a separate credential whose blast radius is OpenRouter credit and nothing else.

- [ ] **Step 2: Confirm the Lambda's own policy is unaffected**

The Lambda execution role's S3 policy (`aws_iam_role_policy.lambda_s3`) is a separate resource and is **not** in scope here. Read it to confirm it does not reference the prefixes being changed, and leave it alone.

```bash
grep -n "lambda_s3" -A 25 infra/main/shared.tf
```

- [ ] **Step 3: Format and validate**

```bash
cd infra/main && terraform fmt && terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
git add infra/main/shared.tf
git commit -m "feat(infra): scope Vercel IAM policy to least privilege

Replaces bucket-wide s3 access with explicit prefixes and adds
DeleteObject on resume drafts only.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 5: Project budget with SNS alerts

The account has a $20/month budget; this project has none. Measured baseline is $0.11-$0.28/month (spec §9).

**Files:**
- Modify: `infra/main/variables.tf` (add `alert_email`)
- Modify: `infra/main/terraform.tfvars` (gitignored — add the value locally)
- Modify: `infra/main/shared.tf` (append SNS topic and budget)

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Add the variable**

Append to `variables.tf`:

```hcl
variable "alert_email" {
  description = "Address that receives budget threshold notifications. The SNS email subscription must be confirmed manually from the inbox after the first apply."
  type        = string
}
```

- [ ] **Step 2: Add the value to tfvars**

`terraform.tfvars` is gitignored, so this is a local-only edit. Append:

```hcl
alert_email = "ashutosh.pandeyhlr007@gmail.com"
```

- [ ] **Step 3: Add the SNS topic and budget**

Append to `shared.tf`:

```hcl
resource "aws_sns_topic" "budget_alerts" {
  name = "${var.project_name}-budget-alerts"
}

resource "aws_sns_topic_subscription" "budget_alerts_email" {
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic_policy" "budget_alerts" {
  arn = aws_sns_topic.budget_alerts.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "budgets.amazonaws.com" }
      Action    = "SNS:Publish"
      Resource  = aws_sns_topic.budget_alerts.arn
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

# Measured baseline for this project is $0.11-$0.28/month (design spec §9). A $5 cap is
# roughly 20x headroom — high enough not to cry wolf, low enough to catch a runaway.
resource "aws_budgets_budget" "project" {
  name         = "${var.project_name}-monthly-cap"
  budget_type  = "COST"
  limit_amount = "5.0"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 80
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
  }
}
```

The budget is **not** filtered by tag. The `magma-learning` budget uses a `user:project` tag filter, but this project's resources are not consistently tagged, so a tag filter would silently match nothing. An unfiltered account-scoped budget at $5 is the honest version; tagging every resource is separate work.

- [ ] **Step 4: Format and validate**

```bash
cd infra/main && terraform fmt && terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
git add infra/main/shared.tf infra/main/variables.tf
git commit -m "feat(infra): add project budget with SNS alerts

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 6: Add the resume and OpenRouter env vars

**Files:**
- Modify: `infra/main/shared.tf` (append four `vercel_project_environment_variable` resources)
- Modify: `infra/main/variables.tf` (add `openrouter_api_key`, `openrouter_model`)
- Modify: `infra/main/terraform.tfvars` (gitignored — add the key locally)

**Interfaces:**
- Consumes: the model slug confirmed in Task 1
- Produces: `RESUME_BUCKET_NAME`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`,
  read by Phase 2's routes

- [ ] **Step 1: Add the variables**

Append to `variables.tf`:

```hcl
variable "openrouter_api_key" {
  description = "OpenRouter key used for resume extraction. Its blast radius is OpenRouter credit only — cap the key's spend limit in the OpenRouter dashboard as a backstop the app cannot override."
  type        = string
  sensitive   = true
}

variable "openrouter_model" {
  description = "Model slug for resume extraction. A variable so switching model is config, not code — see the design spec §5.2."
  type        = string
  default     = "anthropic/claude-haiku-4.5"
}
```

If Task 1 found Haiku 4.5's extraction quality inadequate, change the default to whichever slug
passed there.

- [ ] **Step 2: Add the key to tfvars**

`terraform.tfvars` is gitignored, so this is a local-only edit. Append:

```hcl
openrouter_api_key = "<the key>"
```

Confirm it is not tracked before continuing:

```bash
git check-ignore -v infra/main/terraform.tfvars
```

Expected: a line naming the ignore rule. If it prints nothing, **stop** — the file is tracked and
the key would be committed.

- [ ] **Step 3: Add the env vars**

These go in `shared.tf`, **not** `environments.tf` — they are env-agnostic, so they follow the
`APP_PASSWORD` pattern rather than the per-branch `S3_BUCKET_NAME` overrides (spec §4.1).

```hcl
# All three branches read and write the resume from main's bucket, so unlike
# S3_BUCKET_NAME this is not overridden per branch. See the design spec §4.1.
resource "vercel_project_environment_variable" "resume_bucket_name" {
  project_id = vercel_project.looper.id
  key        = "RESUME_BUCKET_NAME"
  value      = aws_s3_bucket.audio.id
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "openrouter_api_key" {
  project_id = vercel_project.looper.id
  key        = "OPENROUTER_API_KEY"
  value      = var.openrouter_api_key
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "openrouter_model" {
  project_id = vercel_project.looper.id
  key        = "OPENROUTER_MODEL"
  value      = var.openrouter_model
  target     = local.env_targets
  sensitive  = false
}

# Kept as config so the extract route can be pointed at any OpenAI-compatible
# endpoint without a code change — see the design spec §5.2.
resource "vercel_project_environment_variable" "openrouter_base_url" {
  project_id = vercel_project.looper.id
  key        = "OPENROUTER_BASE_URL"
  value      = "https://openrouter.ai/api/v1"
  target     = local.env_targets
  sensitive  = false
}
```

`sensitive = true` on the key matters: the Vercel provider requires it for secret values, and it
keeps the key out of `terraform plan` output. This is the same break that bit PR #54 on the
provider upgrade.

- [ ] **Step 4: Format and validate**

```bash
cd infra/main && terraform fmt && terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Confirm no secret leaked into the diff**

```bash
git diff --cached --no-color | grep -i "sk-or-" && echo "SECRET IN DIFF - STOP" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add infra/main/shared.tf infra/main/variables.tf
git commit -m "feat(infra): add resume bucket and OpenRouter env vars

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 7: Verify the Terraform plan and open the infra PR

CI does not validate Terraform at all. This task is the only gate.

**Files:** none (verification + PR)

**Interfaces:**
- Consumes: Tasks 2-6
- Produces: merged infra changes

- [ ] **Step 1: Create a scratch worktree**

Do not run `plan` in the main checkout — a stray `.terraform` directory or a partial apply is harder to reason about there.

```bash
git worktree add /tmp/tf-plan-resume feat/resume-pipeline
cd /tmp/tf-plan-resume/infra/main
cp /e/Personal/looper/infra/main/terraform.tfvars .
terraform init
```

- [ ] **Step 2: Run the plan**

```bash
terraform plan -var-file=terraform.tfvars
```

Expected — **exactly** this set, and nothing else:

- `aws_s3_bucket_lifecycle_configuration.audio` — **update in place** (1 rule → 4 rules)
- `aws_s3_bucket_lifecycle_configuration.audio_env["dev"]`, `["stage"]` — **update in place**
- `aws_s3_bucket_cors_configuration.audio` — **update in place** (origins `*` → 4 entries)
- `aws_s3_bucket_cors_configuration.audio_env["dev"]`, `["stage"]` — **update in place**
- `aws_s3_account_public_access_block.account` — **create**
- `aws_iam_user_policy.vercel` — **update in place**
- `aws_sns_topic.budget_alerts`, `aws_sns_topic_subscription.budget_alerts_email`, `aws_sns_topic_policy.budget_alerts` — **create**
- `aws_budgets_budget.project` — **create**
- `vercel_project_environment_variable.resume_bucket_name`, `.openrouter_api_key`,
  `.openrouter_model`, `.openrouter_base_url` — **create**

**Stop and investigate if the plan shows any destroy, or any change to a Lambda function, the ECR repo, the S3 buckets themselves, or an existing Vercel env var.** A destroy of `aws_s3_bucket.audio` would delete production audio. `No changes.` is *not* the expected outcome here — that would mean the edits are not being read.

- [ ] **Step 3: Clean up the worktree**

```bash
cd /e/Personal/looper
git worktree remove /tmp/tf-plan-resume --force
```

- [ ] **Step 4: Add the CHANGELOG entry**

Under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Added
- Project-scoped AWS budget ($5/month) with SNS email alerts.
- Account-level S3 public access block.
- `RESUME_BUCKET_NAME`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and `OPENROUTER_BASE_URL`
  environment variables.

### Changed
- S3 lifecycle rules are now prefix-scoped: audio scratch and resume drafts expire after
  1 day, resume archives after 365 days, and the live resume never expires.
- Bucket CORS is scoped to the app's own origins instead of `*`.
- The Vercel IAM user's S3 access is scoped to specific prefixes rather than whole buckets.
```

- [ ] **Step 5: Commit and open the PR**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): infra hardening for the resume pipeline

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/resume-pipeline
gh pr create --base dev --title "feat(infra): prefix-scoped lifecycle, least-privilege IAM, budget" --body "$(cat <<'EOF'
Phase 1 (infrastructure half) of the resume pipeline.

Implements §4.2, §9.1, §10, and §11.4 of
`docs/superpowers/specs/2026-09-05-resume-pipeline-design.md`.

- Prefix-scoped S3 lifecycle rules so a stored resume is not deleted after a day
- Vercel IAM policy scoped to specific S3 prefixes
- Bucket CORS scoped to app origins; account-level public access block added
- $5/month project budget with SNS email alerts

`terraform plan` verified in a scratch worktree; output matches the expected set in the
plan document, no destroys.

Note: the SNS email subscription requires a one-time manual confirmation from the inbox
after apply.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Merge per the standing sequence**

Follow CLAUDE.md's "Merging a PR": wait for CI `test` to complete green, wait for `aws-devops-agent/release-readiness-review` to report `change approved` (it is a **commit status**, not a check-run — `gh api repos/DataCrusade1999/supreme-enigma/commits/<sha>/status`), then `gh pr merge <N> --squash --delete-branch`, then `git checkout dev && git pull --ff-only origin dev`.

- [ ] **Step 7: Apply, and confirm the SNS subscription**

```bash
cd infra/main && terraform apply -var-file=terraform.tfvars
```

Then confirm the subscription email from the inbox — the budget will not notify until it is confirmed.

Verify the lifecycle rules landed:

```bash
aws s3api get-bucket-lifecycle-configuration \
  --bucket bgm-looper-audio-223376380711 \
  --profile personal --region us-east-1
```

Expected: four rules, with no rule whose prefix matches `resume/current`.

---

## Task 8: Make `checkPassword` constant-time

`checkPassword` returns early when lengths differ, which defeats the `timingSafeEqual` it then calls and leaks the password length.

**Files:**
- Modify: `app/lib/auth.ts`
- Test: `app/lib/auth.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `checkPassword(submitted: string, actual: string): boolean` — unchanged signature

- [ ] **Step 1: Write the failing test**

Append to `app/lib/auth.test.ts`:

```ts
describe("checkPassword", () => {
  it("accepts the correct password", () => {
    expect(checkPassword("hunter2", "hunter2")).toBe(true);
  });

  it("rejects a wrong password of the same length", () => {
    expect(checkPassword("hunter3", "hunter2")).toBe(false);
  });

  it("rejects a wrong password of a different length", () => {
    expect(checkPassword("short", "a-much-longer-password")).toBe(false);
  });

  it("rejects an empty submission", () => {
    expect(checkPassword("", "hunter2")).toBe(false);
  });

  it("compares buffers of equal length regardless of input length", () => {
    // timingSafeEqual throws RangeError on unequal-length buffers. If the
    // implementation hashes first, both buffers are always 32 bytes and it
    // never throws — which is the property we want.
    expect(() => checkPassword("x", "yyyyyyyyyyyyyyyyyyyy")).not.toThrow();
  });
});
```

Ensure `checkPassword` is in the import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run lib/auth.test.ts
```

Expected: the different-length cases pass trivially today (the early return returns `false`), so this test alone does not prove the fix. The real signal is Step 3 — the test locks in behavior so the refactor cannot regress correctness.

- [ ] **Step 3: Implement the constant-time comparison**

Hash both inputs to a fixed width first, so the buffers are always the same length and `timingSafeEqual` does the whole job.

In `app/lib/auth.ts`, replace `checkPassword`:

```ts
export function checkPassword(submitted: string, actual: string): boolean {
  // Hash both sides to a fixed 32 bytes before comparing. Comparing the raw
  // strings required an early length check, and that early return leaked the
  // real password's length through response timing.
  const a = createHash("sha256").update(submitted).digest();
  const b = createHash("sha256").update(actual).digest();
  return timingSafeEqual(a, b);
}
```

Add `createHash` to the existing import:

```ts
import { createHash, createHmac, timingSafeEqual } from "crypto";
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run lib/auth.test.ts
```

Expected: PASS, all five cases.

- [ ] **Step 5: Commit**

```bash
git add app/lib/auth.ts app/lib/auth.test.ts
git commit -m "fix(auth): make checkPassword genuinely constant-time

The length check returned before timingSafeEqual ran, leaking the
password length through timing. Hashing both sides to a fixed width
removes the need for the early return.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 9: Give the session cookie a real expiry

The signed payload is the constant string `"authenticated"`, so the cookie value never changes and never expires server-side. A copied cookie is valid until `COOKIE_SECRET` rotates.

**Files:**
- Modify: `app/lib/auth.ts`
- Test: `app/lib/auth.test.ts`
- Modify: `app/proxy.ts` (verify call site still compiles)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `createSessionCookieValue(secret: string, now?: number): string`
  - `verifySessionCookieValue(cookieValue: string | undefined, secret: string, now?: number): boolean`
  - `SESSION_MAX_AGE_MS: number`

  Both `now` parameters default to `Date.now()` so production call sites are unchanged.

- [ ] **Step 1: Write the failing tests**

Replace the existing `verifySessionCookieValue` describe block in `app/lib/auth.test.ts` with:

```ts
describe("session cookie", () => {
  const SECRET = "test-secret";
  const T0 = 1_700_000_000_000;

  it("accepts a freshly issued cookie", () => {
    const value = createSessionCookieValue(SECRET, T0);
    expect(verifySessionCookieValue(value, SECRET, T0)).toBe(true);
  });

  it("accepts a cookie just inside the max age", () => {
    const value = createSessionCookieValue(SECRET, T0);
    expect(
      verifySessionCookieValue(value, SECRET, T0 + SESSION_MAX_AGE_MS - 1),
    ).toBe(true);
  });

  it("rejects a cookie past the max age", () => {
    const value = createSessionCookieValue(SECRET, T0);
    expect(
      verifySessionCookieValue(value, SECRET, T0 + SESSION_MAX_AGE_MS + 1),
    ).toBe(false);
  });

  it("rejects a cookie signed with a different secret", () => {
    const value = createSessionCookieValue("other-secret", T0);
    expect(verifySessionCookieValue(value, SECRET, T0)).toBe(false);
  });

  it("rejects a cookie whose timestamp was tampered with", () => {
    const value = createSessionCookieValue(SECRET, T0);
    const [, sig] = value.split(".");
    const forged = `${T0 + 1}.${sig}`;
    expect(verifySessionCookieValue(forged, SECRET, T0)).toBe(false);
  });

  it("rejects undefined, empty, and malformed values", () => {
    expect(verifySessionCookieValue(undefined, SECRET, T0)).toBe(false);
    expect(verifySessionCookieValue("", SECRET, T0)).toBe(false);
    expect(verifySessionCookieValue("no-separator", SECRET, T0)).toBe(false);
    expect(verifySessionCookieValue("notanumber.abc", SECRET, T0)).toBe(false);
  });

  it("issues a different value at a different time", () => {
    expect(createSessionCookieValue(SECRET, T0)).not.toBe(
      createSessionCookieValue(SECRET, T0 + 1000),
    );
  });
});
```

Update the import at the top of the file to include `SESSION_MAX_AGE_MS`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd app && npx vitest run lib/auth.test.ts
```

Expected: FAIL — `SESSION_MAX_AGE_MS is not defined`.

- [ ] **Step 3: Implement**

In `app/lib/auth.ts`, replace `createSessionCookieValue` and `verifySessionCookieValue`:

```ts
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// The cookie carries its own issue time, signed alongside the rest. Previously the
// signed payload was the constant "authenticated", so every session produced a
// byte-identical cookie that stayed valid until COOKIE_SECRET was rotated — the
// maxAge set on the response was only a browser-side hint.
export function createSessionCookieValue(secret: string, now = Date.now()): string {
  const issuedAt = String(now);
  return `${issuedAt}.${sign(issuedAt, secret)}`;
}

export function verifySessionCookieValue(
  cookieValue: string | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (!cookieValue) return false;

  const [issuedAt, sig] = cookieValue.split(".");
  if (!issuedAt || !sig) return false;

  const expected = sign(issuedAt, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  const issuedAtMs = Number(issuedAt);
  if (!Number.isFinite(issuedAtMs)) return false;

  const age = now - issuedAtMs;
  return age >= 0 && age < SESSION_MAX_AGE_MS;
}
```

The length check before `timingSafeEqual` here is fine and stays: both sides are
hex digests of a fixed width, so it only fires on a malformed cookie, and it leaks
nothing about the secret.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd app && npx vitest run lib/auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Confirm the call sites still typecheck**

`app/proxy.ts` and `app/app/api/login/route.ts` both call these with two and one argument respectively; the new `now` parameter is optional, so neither needs a change.

```bash
cd app && npx tsc --noEmit && npm run lint
```

Expected: no errors.

- [ ] **Step 6: Run the full unit suite**

```bash
cd app && npm test
```

Expected: PASS. Existing sessions are invalidated by this change — that is intended, and means one re-login after deploy.

- [ ] **Step 7: Commit**

```bash
git add app/lib/auth.ts app/lib/auth.test.ts
git commit -m "fix(auth): give the session cookie a server-enforced expiry

The signed payload was a constant, so every cookie was byte-identical
and valid forever. It now carries a signed issued-at timestamp checked
against SESSION_MAX_AGE_MS.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 10: Rate-limit the login route

`/api/login` accepts unlimited password attempts. This is the single point of failure for the whole "only I can upload" guarantee.

**Files:**
- Create: `app/lib/rate-limit.ts`
- Create: `app/lib/rate-limit.test.ts`
- Modify: `app/app/api/login/route.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `checkRateLimit(key: string, now?: number): { allowed: boolean; retryAfterSeconds: number }`
  - `resetRateLimits(): void` — test helper
  - `LOGIN_MAX_ATTEMPTS: number`, `LOGIN_WINDOW_MS: number`

- [ ] **Step 1: Write the failing test**

Create `app/lib/rate-limit.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  resetRateLimits,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
} from "./rate-limit";

describe("checkRateLimit", () => {
  const T0 = 1_700_000_000_000;

  beforeEach(() => {
    resetRateLimits();
  });

  it("allows attempts up to the limit", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      expect(checkRateLimit("1.2.3.4", T0).allowed).toBe(true);
    }
  });

  it("blocks the attempt after the limit", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      checkRateLimit("1.2.3.4", T0);
    }
    const result = checkRateLimit("1.2.3.4", T0);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      checkRateLimit("1.2.3.4", T0);
    }
    expect(checkRateLimit("1.2.3.4", T0).allowed).toBe(false);
    expect(checkRateLimit("5.6.7.8", T0).allowed).toBe(true);
  });

  it("allows again once the window has passed", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      checkRateLimit("1.2.3.4", T0);
    }
    expect(checkRateLimit("1.2.3.4", T0).allowed).toBe(false);
    expect(checkRateLimit("1.2.3.4", T0 + LOGIN_WINDOW_MS + 1).allowed).toBe(true);
  });

  it("reports a shrinking retry-after as the window elapses", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      checkRateLimit("1.2.3.4", T0);
    }
    const early = checkRateLimit("1.2.3.4", T0).retryAfterSeconds;
    const later = checkRateLimit("1.2.3.4", T0 + LOGIN_WINDOW_MS / 2).retryAfterSeconds;
    expect(later).toBeLessThan(early);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run lib/rate-limit.test.ts
```

Expected: FAIL — cannot resolve `./rate-limit`.

- [ ] **Step 3: Implement**

Create `app/lib/rate-limit.ts`:

```ts
// Fixed-window limiter held in module memory. Vercel runs each serverless instance
// separately, so a determined attacker spread across many cold starts gets more than
// LOGIN_MAX_ATTEMPTS total — this is a speed bump, not a distributed rate limiter.
// It is deliberately not backed by Redis or DynamoDB: a shared store is a recurring
// cost and an extra dependency, and for a single-user site the speed bump plus a
// strong APP_PASSWORD is the right trade. Revisit if the site ever gets real users.

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

type Window = { count: number; startedAt: number };

const windows = new Map<string, Window>();

export function resetRateLimits(): void {
  windows.clear();
}

export function checkRateLimit(
  key: string,
  now = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const existing = windows.get(key);

  if (!existing || now - existing.startedAt >= LOGIN_WINDOW_MS) {
    windows.set(key, { count: 1, startedAt: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= LOGIN_MAX_ATTEMPTS) {
    const remainingMs = existing.startedAt + LOGIN_WINDOW_MS - now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run lib/rate-limit.test.ts
```

Expected: PASS, all six cases.

- [ ] **Step 5: Commit the limiter**

```bash
git add app/lib/rate-limit.ts app/lib/rate-limit.test.ts
git commit -m "feat(auth): add a fixed-window rate limiter

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

- [ ] **Step 6: Apply it to the login route**

Replace `app/app/api/login/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSessionCookieValue, COOKIE_NAME } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

function clientKey(request: NextRequest): string {
  // Vercel sets x-forwarded-for; the first entry is the client. Fall back to a
  // constant so a missing header fails closed into one shared bucket rather than
  // handing every request its own unlimited allowance.
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(clientKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "too many attempts" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { password } = await request.json();

  if (!checkPassword(password ?? "", process.env.APP_PASSWORD!)) {
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    COOKIE_NAME,
    createSessionCookieValue(process.env.COOKIE_SECRET!),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    },
  );
  return response;
}
```

Note the fallback key is `"unknown"`, not a per-request unique value: if the header is ever absent, everyone shares one bucket and the limiter still bites. The opposite choice would disable it silently.

- [ ] **Step 7: Verify lint and the full suite**

```bash
cd app && npm run lint && npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/app/api/login/route.ts
git commit -m "feat(auth): rate-limit the login route

Unlimited password attempts were the single point of failure for the
whole access model. Five attempts per IP per 15 minutes, returning 429
with Retry-After.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 11: Bind the upload size limit into the presigned URL

`presignUpload` signs only Bucket, Key, and ContentType, so a signed URL authorizes an object of any size up to S3's 5 GB single-PUT ceiling. Signing an exact `ContentLength` makes it a signed header the client cannot exceed.

**Files:**
- Modify: `app/lib/aws.ts`
- Test: `app/lib/aws.test.ts`
- Modify: `app/app/api/looper/upload-url/route.ts`
- Modify: `app/app/tools/bgm-looper/page.tsx:17-21`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `presignUpload(key: string, contentType: string, contentLength: number): Promise<string>`
  - `MAX_AUDIO_UPLOAD_BYTES: number`, `MAX_RESUME_UPLOAD_BYTES: number`

  `MAX_RESUME_UPLOAD_BYTES` is exported here and consumed by Phase 2's resume upload route.

- [ ] **Step 1: Write the failing test**

Append to `app/lib/aws.test.ts`:

```ts
import { MAX_AUDIO_UPLOAD_BYTES, MAX_RESUME_UPLOAD_BYTES, presignUpload } from "./aws";

describe("upload size limits", () => {
  it("caps resume uploads at 5 MB", () => {
    expect(MAX_RESUME_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });

  it("caps audio uploads well above the resume limit", () => {
    expect(MAX_AUDIO_UPLOAD_BYTES).toBeGreaterThan(MAX_RESUME_UPLOAD_BYTES);
  });

  it("signs the content length into the URL", async () => {
    process.env.APP_AWS_REGION = "us-east-1";
    process.env.S3_BUCKET_NAME = "test-bucket";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";

    const url = await presignUpload("uploads/a.mp3", "audio/mpeg", 1234);

    // content-length appears in the signed-headers list, so a client sending a
    // different length fails signature validation rather than being trusted.
    expect(decodeURIComponent(url)).toContain("content-length");
  });
});
```

Merge the new import with the existing one at the top of the file rather than adding a second import from `./aws`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run lib/aws.test.ts
```

Expected: FAIL — `MAX_RESUME_UPLOAD_BYTES` is not exported.

- [ ] **Step 3: Implement**

In `app/lib/aws.ts`, replace `presignUpload` and add the constants:

```ts
// Signed into the presigned URL rather than checked after the fact. A URL signed
// without a length authorizes an object of any size up to S3's 5 GB single-PUT
// ceiling; by the time a server-side size check runs, the bytes have already been
// stored and paid for.
export const MAX_AUDIO_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_RESUME_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function presignUpload(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(client, command, { expiresIn: 300 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run lib/aws.test.ts
```

Expected: PASS.

- [ ] **Step 5: Validate the size in the upload-url route**

Replace `app/app/api/looper/upload-url/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { keyForUpload, presignUpload, MAX_AUDIO_UPLOAD_BYTES } from "@/lib/aws";

export async function POST(request: NextRequest) {
  const { filename, contentType, size } = await request.json();

  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return NextResponse.json({ error: "size is required" }, { status: 400 });
  }
  if (size > MAX_AUDIO_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  const key = keyForUpload(filename);
  const uploadUrl = await presignUpload(key, contentType, size);
  return NextResponse.json({ key, uploadUrl });
}
```

- [ ] **Step 6: Send the size from the client**

In `app/app/tools/bgm-looper/page.tsx`, the request body at line 20 becomes:

```ts
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
```

The `PUT` that follows needs no change — the browser sets `Content-Length` from the
body automatically, and it will match the signed value.

- [ ] **Step 7: Verify lint, types, and the full unit suite**

```bash
cd app && npm run lint && npx tsc --noEmit && npm test
```

Expected: PASS.

- [ ] **Step 8: Verify the audio upload still works end to end**

The signed `ContentLength` is enforced by S3, not by our code, so a mismatch only shows
up against real S3. Run the app and upload an actual audio file:

```bash
cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev
```

Log in at `/tools/bgm-looper/login`, upload a short audio file, and confirm it processes
and returns a download link. A signature mismatch would surface as a 403 from S3 on the
PUT.

- [ ] **Step 9: Commit**

```bash
git add app/lib/aws.ts app/lib/aws.test.ts app/app/api/looper/upload-url/route.ts app/app/tools/bgm-looper/page.tsx
git commit -m "fix(upload): bind the size limit into the presigned URL

A URL signed with only Bucket/Key/ContentType authorized an object of
any size up to 5 GB. The client now declares the size, the route rejects
oversized requests, and the length is signed so S3 enforces it.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

## Task 12: Playwright coverage for the login rate limit, then open the app PR

**Files:**
- Create: `app/e2e/login-rate-limit.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 8-11
- Produces: merged app hardening

- [ ] **Step 1: Check the existing e2e conventions**

```bash
ls app/e2e/ && sed -n '1,40p' app/e2e/*.spec.ts | head -60
```

Match the existing file's import style, base URL handling, and any auth helper before
writing the new spec.

- [ ] **Step 2: Write the spec**

Create `app/e2e/login-rate-limit.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("the login endpoint starts refusing after repeated bad passwords", async ({
  request,
}) => {
  const attempt = () =>
    request.post("/api/login", { data: { password: "definitely-wrong" } });

  // The limiter allows 5 per window; the 6th must be refused.
  for (let i = 0; i < 5; i++) {
    expect((await attempt()).status()).toBe(401);
  }

  const blocked = await attempt();
  expect(blocked.status()).toBe(429);
  expect(blocked.headers()["retry-after"]).toBeTruthy();
});
```

This spec is order-dependent on the limiter's module state, so it must be the only test
in its file. If the Playwright config runs files in parallel workers against one server,
a sibling test hitting `/api/login` could consume the same budget — keep login tests
consolidated here.

- [ ] **Step 3: Run it**

```bash
cd app && npx playwright test e2e/login-rate-limit.spec.ts
```

Expected: PASS. If Chromium is missing, run `npx playwright install chromium` first.

- [ ] **Step 4: Run the whole gate**

CI runs both runners and fails if either fails, so `npm test` alone is not sufficient.

```bash
cd app && npm test && npm run test:e2e && npm run lint
```

Expected: all PASS.

- [ ] **Step 5: Add the CHANGELOG entry**

Under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Security
- The login endpoint is rate-limited to 5 attempts per IP per 15 minutes.
- Session cookies now carry a signed issued-at timestamp and expire server-side after
  7 days. Existing sessions are invalidated; one re-login is required.
- `checkPassword` no longer returns early on a length mismatch, which leaked the
  password length through timing.
- Presigned upload URLs are signed with an explicit content length, so a URL can no
  longer be used to upload an arbitrarily large object.
```

- [ ] **Step 6: Commit and open the PR**

```bash
git add app/e2e/login-rate-limit.spec.ts CHANGELOG.md
git commit -m "test(e2e): cover the login rate limit

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push
gh pr create --base dev --title "fix(auth): rate limiting, session expiry, and bounded uploads" --body "$(cat <<'EOF'
Phase 1 (application half) of the resume pipeline.

Implements §11.1, §11.2, and §11.3 of
`docs/superpowers/specs/2026-09-05-resume-pipeline-design.md`.

- `/api/login` is rate-limited: 5 attempts per IP per 15 minutes, 429 with Retry-After
- Session cookies carry a signed issued-at timestamp and expire server-side
- `checkPassword` is genuinely constant-time
- Presigned upload URLs are signed with an explicit content length

All four gaps are pre-existing and none is introduced by the resume work. They are in
scope because the resume is the first thing this bucket stores that is worth keeping.

**Existing sessions are invalidated by the cookie change** — expect one re-login after
deploy.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Merge per the standing sequence**

As in Task 7 Step 6: green `test`, then `aws-devops-agent/release-readiness-review`
reporting `change approved` via the **commit status** API, then squash-merge, then
`git checkout dev && git pull --ff-only origin dev`.

- [ ] **Step 8: Verify against the deployed preview**

After the merge deploys to `dev`, confirm the login page still works (one re-login is
expected) and that repeated bad passwords produce a 429.

---

## Phases 2 and 3

Not planned in this document, deliberately.

Phase 2's extraction task depends on Task 1's spike: the exact request shape, the model
that passes, and the measured per-run cost all come out of running the probe against your
real resume. Writing those steps before the probe would mean inventing them.

Unlike the original Bedrock design, this is no longer blocked on AWS — Task 1 is runnable
now, and Phase 2 can be planned as soon as it has run.

Once Task 1's finding is recorded in the spec, invoke
`superpowers:writing-plans` again for:

- `docs/superpowers/plans/<date>-resume-pipeline-phase-2.md` — schema, key helpers, the
  API routes, gate entries, admin UI with review and preview
- `docs/superpowers/plans/<date>-resume-pipeline-phase-3.md` — cached S3 read with the
  placeholder fallback, resume timeline and skills section, About headline and summary,
  the `/resume.pdf` route handler
