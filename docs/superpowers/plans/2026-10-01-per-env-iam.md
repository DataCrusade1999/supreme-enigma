# Per-environment IAM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each environment its own Lambda exec role and its own Vercel grants, declared in the env stacks, with a production and a preview Vercel role in `shared`, without any deployment losing a permission during the switch.

**Architecture:** The module gains an exec role, its two policies and a per-env Vercel policy. `shared` gains a preview Vercel role, a resume policy on each Vercel role, and a per-target `APP_AWS_ROLE_ARN`. PR A adds everything new alongside the old grants; PR B removes the old ones after dev and stage are redeployed and checked.

**Tech Stack:** Terraform 1.15, `hashicorp/aws ~> 6.62`, `vercel/vercel ~> 5.15`; S3 backend; Git Bash on Windows.

**Spec:** `docs/superpowers/specs/2026-10-01-per-env-iam-design.md` (issue #333)

## Global Constraints

- Every local Terraform command runs with `export AWS_PROFILE=personal`; every `aws` CLI command passes `--profile personal --region us-east-1`.
- Every apply runs from a saved plan: `terraform plan -var-file=terraform.tfvars -out=<file>`, read the counts and the IAM JSON, then `terraform apply <file>`. A plan whose counts differ from the task's `Expected` is not applied.
- Order is binding: `shared` (Task 3) before any env stack (Task 4); env stacks dev → stage → main; Tasks 3 and 4 back to back, with no push to `dev` or `stage` in between.
- `vercel_project_environment_variable.aws_role_arn` must plan as an **update in place**. A replace stops the rollout (spec §4.2).
- Nothing old is removed before Task 7 (PR B).
- Names: exec role `bgm-looper-lambda-exec-<env>`; Lambda S3 policy `bgm-looper-lambda-s3-<env>`; per-env Vercel policy `bgm-looper-vercel-<env>`; preview role `bgm-looper-vercel-preview`; resume policies `bgm-looper-vercel-resume`, `bgm-looper-vercel-preview-resume`.
- Comments move verbatim with the statements they describe.
- Commit messages reference `#333` and end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`. Follow the `merging-a-pr` skill before every merge.

## Review Focus

1. **Policy scope.** Each per-env policy must name only that env's bucket and function. A copy-paste that leaves `all_data_bucket_arns` in the module would plan fine and grant everything. Task 4 greps the plan's JSON for the other envs' names.
2. **Role picked by target.** Stage has `vercel_target = ["preview"]` plus `git_branch`; it must attach to the preview role, main to `bgm-looper-vercel`. Task 4 checks the `role` in each plan.
3. **IAM propagation on the function role switch.** A just-created role can be briefly unassumable by Lambda. The provider retries `InvalidParameterValueException: The role defined for the function cannot be assumed by Lambda`; if the apply still fails, re-run the same plan step (Task 4 Step 4).
4. **`APP_AWS_ROLE_ARN` overlap.** Creating the preview value before narrowing the existing one gives Vercel two `preview` values. `depends_on` orders it; Task 3 checks the plan order is update-then-create.
5. **Builds between Task 3 and Task 6.** A preview build in that window picks up the preview role. Covered by running Tasks 3-4 back to back and redeploying in Task 5.

---

### Task 1: Module — per-env exec role and Vercel policy

**Files:**
- Modify: `infra/modules/environment/main.tf`

**Interfaces:**
- Consumes: shared roles by name: `${var.project_name}-vercel` and `${var.project_name}-vercel-preview` (the latter created in Task 2/3).
- Produces: resources `aws_iam_role.lambda_exec`, `aws_iam_role_policy_attachment.lambda_basic`, `aws_iam_role_policy.lambda_s3`, `aws_iam_role_policy.vercel` in each env stack's `module.environment`.

- [ ] **Step 1: Replace the exec role lookup**

Delete:
```hcl
data "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec"
}
```
In its place:
```hcl
# The Vercel role this environment's deployments assume. Vercel's OIDC subject has
# only production and preview, so dev and stage share the preview role — see the
# per-env IAM spec §6.
data "aws_iam_role" "vercel" {
  name = contains(var.vercel_target, "production") ? "${var.project_name}-vercel" : "${var.project_name}-vercel-preview"
}
```

- [ ] **Step 2: Add the exec role above `# --- Lambda ---`'s function**

Directly under the `# --- Lambda ---` comment pair, before `resource "aws_lambda_function" "this"`:
```hcl
# One exec role per environment, so each function can reach only its own bucket.
# The app passes this environment's S3_BUCKET_NAME in every invoke payload.
resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec-${var.env}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_s3" {
  name = "${var.project_name}-lambda-s3-${var.env}"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = ["${aws_s3_bucket.data.arn}/*"]
    }]
  })
}

```

- [ ] **Step 3: Point the function at it**

In `resource "aws_lambda_function" "this"`, replace `role          = data.aws_iam_role.lambda_exec.arn` with `role          = aws_iam_role.lambda_exec.arn`, and add after `memory_size   = 1024`:
```hcl

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.lambda_s3]
```

- [ ] **Step 4: Add the per-env Vercel policy at the end of the file**

```hcl

# --- What this environment's deployments may do, on the Vercel role for its target.
#     The resume grants are not here: the resume lives in main's bucket and every
#     environment uses it, so they stay in infra/shared/shared.tf. ---

resource "aws_iam_role_policy" "vercel" {
  name = "${var.project_name}-vercel-${var.env}"
  role = data.aws_iam_role.vercel.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AudioScratchObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${aws_s3_bucket.data.arn}/uploads/*", "${aws_s3_bucket.data.arn}/outputs/*"]
      },
      {
        Sid      = "NewsDeskObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${aws_s3_bucket.data.arn}/news-desk/*"]
      },
      {
        # <moved verbatim: the 4-line comment above NewsDeskMissingSnapshotIs404 in
        # infra/shared/shared.tf, with "in the three data buckets" changed to
        # "in this environment's bucket">
        Sid      = "NewsDeskMissingSnapshotIs404"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.data.arn]
      },
      {
        Sid      = "InvokeProcessor"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = [aws_lambda_function.this.arn]
      }
    ]
  })
}
```
The `<moved verbatim …>` lines are replaced by that comment; they are instructions, not file content.

- [ ] **Step 5: Validate**

```bash
cd /e/Personal/looper/infra/modules/environment
terraform fmt -check && terraform init -backend=false >/dev/null && terraform validate
rm -rf .terraform .terraform.lock.hcl
grep -n 'all_data_bucket_arns\|all_lambda_function_arns\|data.aws_iam_role.lambda_exec' main.tf
```
Expected: `Success! The configuration is valid.`, and the grep prints nothing.

- [ ] **Step 6: Commit**

```bash
cd /e/Personal/looper
git add infra/modules/environment/main.tf
git commit -m "feat(infra): give each environment its own exec role and Vercel policy

Refs #333

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 2: `shared` — preview role, resume policies, per-target role ARN

**Files:**
- Modify: `infra/shared/shared.tf`

**Interfaces:**
- Produces: `aws_iam_role.vercel_preview` named `bgm-looper-vercel-preview` (looked up by Task 1's data source).

- [ ] **Step 1: Preview role** — after `resource "aws_iam_role" "vercel"`'s closing brace:

```hcl

# Preview deployments (dev and stage) assume this role; production assumes
# aws_iam_role.vercel. Vercel's subject has no per-branch environment, so dev and
# stage share it and each holds the other's grants — per-env IAM spec §6.
resource "aws_iam_role" "vercel_preview" {
  name = "${var.project_name}-vercel-preview"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.vercel.arn }
      Condition = {
        StringEquals = {
          "oidc.vercel.com/${local.vercel_team_slug}:aud" = "https://vercel.com/${local.vercel_team_slug}"
          "oidc.vercel.com/${local.vercel_team_slug}:sub" = "owner:${local.vercel_team_slug}:project:${var.project_name}:environment:preview"
        }
      }
    }]
  })
}
```

- [ ] **Step 2: Resume policies** — after `resource "aws_iam_role_policy" "vercel"`'s closing brace. Leave the combined policy unchanged; it is removed in Task 7.

```hcl

# The resume lives in main's bucket and all three environments read and write it,
# so these grants stay here rather than in the env stacks, on both Vercel roles.
locals {
  vercel_resume_statements = [
    {
      Sid      = "ResumeObjects"
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject"]
      Resource = ["${local.resume_bucket_arn}/resume/*"]
    },
    {
      # <moved verbatim: the 7-line comment above ResumeHeadObjectNotFound in
      # aws_iam_role_policy.vercel — copied, since the combined policy keeps its own
      # copy until Task 7>
      Sid      = "ResumeHeadObjectNotFound"
      Effect   = "Allow"
      Action   = ["s3:ListBucket"]
      Resource = [local.resume_bucket_arn]
    },
  ]
}

resource "aws_iam_role_policy" "vercel_resume" {
  name   = "${var.project_name}-vercel-resume"
  role   = aws_iam_role.vercel.id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.vercel_resume_statements })
}

resource "aws_iam_role_policy" "vercel_preview_resume" {
  name   = "${var.project_name}-vercel-preview-resume"
  role   = aws_iam_role.vercel_preview.id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.vercel_resume_statements })
}
```

- [ ] **Step 3: `APP_AWS_ROLE_ARN` per target**

In `resource "vercel_project_environment_variable" "aws_role_arn"`, change `target     = local.env_targets` to `target     = ["production"]`. After that resource, add:
```hcl

# depends_on: the production value must be narrowed off `preview` before this one
# exists, or Vercel holds two preview values for the same key.
resource "vercel_project_environment_variable" "aws_role_arn_preview" {
  project_id = vercel_project.looper.id
  key        = "APP_AWS_ROLE_ARN"
  value      = aws_iam_role.vercel_preview.arn
  target     = ["preview"]
  sensitive  = false

  depends_on = [vercel_project_environment_variable.aws_role_arn]
}
```

- [ ] **Step 4: Validate**

```bash
cd /e/Personal/looper/infra/shared
terraform fmt -check && terraform validate
```
Expected: `Success! The configuration is valid.` (`.terraform` is already initialised against the real backend; `validate` reads no state.)

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper
git add infra/shared/shared.tf
git commit -m "feat(infra): add a preview Vercel role and per-target APP_AWS_ROLE_ARN

Refs #333

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 3: Apply `shared` (spec §7 step 1)

**Files:** none.

- [ ] **Step 1: Plan**

```bash
export AWS_PROFILE=personal
SP=<scratchpad>
cd /e/Personal/looper/infra/shared
terraform plan -var-file=terraform.tfvars -input=false -no-color -out=$SP/shared-a.tfplan > $SP/shared-a.txt 2>&1; echo rc=$?
grep -E '^Plan:|must be replaced|# .* will be' $SP/shared-a.txt
```
Expected: `Plan: 4 to add, 1 to change, 0 to destroy.` The four adds are `aws_iam_role.vercel_preview`, `aws_iam_role_policy.vercel_resume`, `aws_iam_role_policy.vercel_preview_resume`, `vercel_project_environment_variable.aws_role_arn_preview`. The one change is `vercel_project_environment_variable.aws_role_arn` with `will be updated in-place`. No `must be replaced` line. Anything else: stop and report.

- [ ] **Step 2: Apply the saved plan**

```bash
terraform apply -input=false $SP/shared-a.tfplan
```
Expected: `Apply complete! Resources: 4 added, 1 changed, 0 destroyed.`

- [ ] **Step 3: Confirm**

```bash
aws iam list-role-policies --role-name bgm-looper-vercel-preview --profile personal --region us-east-1
terraform plan -var-file=terraform.tfvars -detailed-exitcode -input=false >/dev/null; echo exit=$?
```
Expected: `bgm-looper-vercel-preview-resume` listed; `exit=0`.

---

### Task 4: Apply the env stacks (spec §7 step 2)

**Files:** none. Start immediately after Task 3.

For each `<env>` in `dev`, `stage`, `main`, in that order:

- [ ] **Step 1: Plan**

```bash
cd /e/Personal/looper/infra/envs/<env>
terraform plan -var-file=terraform.tfvars -input=false -no-color -out=$SP/<env>.tfplan > $SP/<env>.txt 2>&1; echo rc=$?
grep -E '^Plan:|# .* will be' $SP/<env>.txt
```
Expected: `Plan: 4 to add, 1 to change, 0 to destroy.` Adds: `aws_iam_role.lambda_exec`, `aws_iam_role_policy_attachment.lambda_basic`, `aws_iam_role_policy.lambda_s3`, `aws_iam_role_policy.vercel`. Change: `aws_lambda_function.this` updated in-place, only `role` changing.

- [ ] **Step 2: Check scope and role** (Review Focus 1 and 2)

```bash
others=$(printf '%s\n' dev stage main | grep -vx <env> | sed 's/^main$/processor"/' )
grep -nE 'portfolio-data-(dev|stage)?-?223376380711|bgm-looper-processor' $SP/<env>.txt | grep -v "$(terraform output -raw data_bucket_name)" | grep -v "$(terraform output -raw lambda_function_name)[^-]" 
grep -n 'role *= *"bgm-looper-vercel' $SP/<env>.txt
```
Expected: the first grep prints nothing (no other env's bucket or function in this plan). The second shows `bgm-looper-vercel` for `main`, `bgm-looper-vercel-preview` for `dev` and `stage`. If the first grep is noisy, read the two policy JSON blocks in `$SP/<env>.txt` directly and confirm every ARN is this env's.

- [ ] **Step 3: Apply**

```bash
terraform apply -input=false $SP/<env>.tfplan
```
Expected: `Apply complete! Resources: 4 added, 1 changed, 0 destroyed.`

- [ ] **Step 4: If the role switch failed on propagation** (Review Focus 3)

If the apply failed with `cannot be assumed by Lambda`, wait 30 seconds, re-plan (Step 1, now expecting `0 to add, 1 to change`) and apply.

- [ ] **Step 5: Confirm**

```bash
aws lambda get-function-configuration --function-name "$(terraform output -raw lambda_function_name)" --query Role --output text --profile personal --region us-east-1
terraform plan -var-file=terraform.tfvars -detailed-exitcode -input=false >/dev/null; echo exit=$?
```
Expected: `arn:aws:iam::223376380711:role/bgm-looper-lambda-exec-<env>`; `exit=0`.

---

### Task 5: Redeploy and check — owner checkpoint (spec §7 step 3)

**Files:** none.

- [ ] **Step 1: Redeploy dev and stage.** In the Vercel dashboard, open the latest `dev` deployment and the latest `stage` deployment and choose **Redeploy** on each. A redeploy rebuilds with the current env vars, so both pick up the preview `APP_AWS_ROLE_ARN`. Production is not redeployed: its value did not change.
- [ ] **Step 2: Owner checks, on dev, stage and production:** sign in; process one track in the BGM Looper; open the News Desk; open `/resume` and the resume admin. **STOP** until the owner reports all three environments pass. A failure: rollback per spec §7.1, report, do not continue.

---

### Task 6: Docs, PR A, merge

**Files:**
- Modify: `CLAUDE.md`, `.claude/rules/infra.md`, `docs/runbooks/infra-apply-teardown.md`, `CHANGELOG.md`

- [ ] **Step 1: Docs**

| Doc | Change |
|---|---|
| `CLAUDE.md` Branching | "All three share one IAM exec role, scoped to all three bucket ARNs." → "Each has its own exec role, `bgm-looper-lambda-exec-<env>`, scoped to its own bucket." |
| `.claude/rules/infra.md` IAM bullet | Replace the `aws_iam_role.vercel` sub-bullet: production deployments assume `bgm-looper-vercel`, preview deployments (dev and stage) `bgm-looper-vercel-preview`; `APP_AWS_ROLE_ARN` is set per target in `shared`; each env stack attaches `bgm-looper-vercel-<env>`, and a feature's new grant goes in `infra/modules/environment/main.tf`'s `aws_iam_role_policy.vercel`, applied to `envs/dev` first. State the §6 limit: dev and stage hold each other's grants. Add that each Lambda's exec role is per env and in the module. Until PR B merges, note that the old combined policy and exec role still exist and are removed in #333's second PR. |
| `docs/runbooks/infra-apply-teardown.md` "What goes" | Name the per-env exec roles and both Vercel roles. |

- [ ] **Step 2: `CHANGELOG.md`** — under `## [Unreleased]` → `### Changed`:

```markdown
- Each environment's Lambda has its own IAM role, limited to its own bucket, and preview deployments (dev and stage) use their own Vercel role instead of production's. The grants for each environment are in its own Terraform stack, so a new permission can be applied to dev alone (#333).
```

- [ ] **Step 3: Verify and commit**

```bash
cd /e/Personal/looper
terraform fmt -check -recursive infra/
git add -A CLAUDE.md .claude/rules/infra.md docs/runbooks/infra-apply-teardown.md CHANGELOG.md
git commit -m "docs(infra): document per-environment IAM roles

Refs #333

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

- [ ] **Step 4: PR A.** Push, open a PR into `dev` with `Refs #333` (not `Closes`: PR B finishes the issue). The body lists Task 3's and Task 4's apply results and the owner's Task 5 checks, and says the old grants are removed in a follow-up PR. Merge per the `merging-a-pr` skill, after re-planning all four stacks from the branch and confirming `No changes.`

---

### Task 7: PR B — remove the old grants (spec §7 step 4)

**Files:**
- Modify: `infra/shared/shared.tf`, `.claude/rules/infra.md`

- [ ] **Step 1: Branch** from the updated `dev`: `git checkout dev && git pull --ff-only && git checkout -b chore/333-remove-shared-grants`.

- [ ] **Step 2: Edit `shared.tf`**
- Delete `resource "aws_iam_role" "lambda_exec"`, `resource "aws_iam_role_policy_attachment" "lambda_basic"`, `resource "aws_iam_role_policy" "lambda_s3"`.
- Delete `resource "aws_iam_role_policy" "vercel"` and the comment block above it ("Carried over from the deleted vercel-sa user's inline policy …"). Move that comment's first three sentences ("Carried over … its comment explains why.") above `locals { vercel_resume_statements`, since `ResumeHeadObjectNotFound` now lives there; drop the sentence about `s3:DeleteObject` only if it no longer has a statement to describe — keep it, it explains an absence that still holds.
- In `resource "aws_iam_role" "vercel"`, set the `sub` condition to the production subject only, and replace the "Two entries, not three…" comment with: `# Production only. Preview deployments assume aws_iam_role.vercel_preview.`
- Delete `all_data_bucket_arns` from the `locals` block at the top, and the comment line naming bucket order; keep `all_lambda_function_arns` (used by `ci_deploy`).

- [ ] **Step 3: Check for leftovers and validate**

```bash
cd /e/Personal/looper/infra/shared
grep -n 'all_data_bucket_arns\|aws_iam_role.lambda_exec\|aws_iam_role_policy.vercel\b' *.tf
terraform fmt -check && terraform validate
```
Expected: grep prints nothing; `Success! The configuration is valid.`

- [ ] **Step 4: Plan, read, apply**

```bash
export AWS_PROFILE=personal
terraform plan -var-file=terraform.tfvars -input=false -no-color -out=$SP/shared-b.tfplan > $SP/shared-b.txt 2>&1; echo rc=$?
grep -E '^Plan:|# .* will be' $SP/shared-b.txt
```
Expected: `Plan: 0 to add, 1 to change, 4 to destroy.` Change: `aws_iam_role.vercel` in-place (trust policy). Destroys: `aws_iam_role.lambda_exec`, `aws_iam_role_policy_attachment.lambda_basic`, `aws_iam_role_policy.lambda_s3`, `aws_iam_role_policy.vercel`. Then:
```bash
terraform apply -input=false $SP/shared-b.tfplan
for d in shared envs/dev envs/stage envs/main; do (cd /e/Personal/looper/infra/$d && terraform plan -var-file=terraform.tfvars -detailed-exitcode -input=false >/dev/null; echo "$d exit=$?"); done
aws iam list-role-policies --role-name bgm-looper-vercel --profile personal --region us-east-1
aws iam list-role-policies --role-name bgm-looper-vercel-preview --profile personal --region us-east-1
```
Expected: `0 added, 1 changed, 4 destroyed`; four `exit=0`; `bgm-looper-vercel` lists `bgm-looper-vercel-main` and `bgm-looper-vercel-resume`; the preview role lists `bgm-looper-vercel-dev`, `bgm-looper-vercel-preview-resume`, `bgm-looper-vercel-stage`.

- [ ] **Step 5: Owner checks** — repeat Task 5 Step 2 on all three environments (no redeploy needed). **STOP** until they pass. Rollback: revert this branch's `shared.tf` and apply.

- [ ] **Step 6: Docs, changelog, commit, PR B**

- `.claude/rules/infra.md`: remove the "until PR B" note added in Task 6.
- `CHANGELOG.md` `### Changed`: `- Production's Vercel role no longer trusts preview deployments or holds dev's and stage's grants, and the shared Lambda exec role is gone (#333).`

```bash
cd /e/Personal/looper
git add -A infra/shared/shared.tf .claude/rules/infra.md CHANGELOG.md
git commit -m "chore(infra): remove the shared exec role and the combined Vercel policy

Closes #333

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```
Open PR B into `dev` with `Closes #333`, listing Step 4's results. Merge per the `merging-a-pr` skill. Promote both PRs to `main` promptly (spec §7).
