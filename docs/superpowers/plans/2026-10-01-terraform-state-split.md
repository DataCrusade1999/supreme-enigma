# Terraform State Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `infra/main`'s single state file with four stacks (`infra/shared`, `infra/envs/{dev,stage,main}`) without changing or recreating any live resource.

**Architecture:** `infra/main` becomes `infra/shared` (59 resources, same addresses). The 24 per-environment resources move into `infra/modules/environment`, called once from each `infra/envs/<env>` root. Shared builds env ARNs from fixed names; envs find shared resources with `data` sources. State moves with `terraform state mv` between local copies, then `state push`. The old remote key is not touched until all four stacks plan `No changes`.

**Tech Stack:** Terraform 1.15 (`required_version >= 1.10.0`), providers `hashicorp/aws ~> 6.62`, `vercel/vercel ~> 5.15`, `hashicorp/random ~> 3.0`; S3 backend with `use_lockfile`; Git Bash on Windows.

**Spec:** `docs/superpowers/specs/2026-10-01-terraform-state-split-design.md` (issue #327)

## Global Constraints

- State bucket `bgm-looper-tf-state-223376380711`, region `us-east-1`, `use_lockfile = true`. Keys: `shared/terraform.tfstate`, `envs/dev/terraform.tfstate`, `envs/stage/terraform.tfstate`, `envs/main/terraform.tfstate`. Old key: `main/terraform.tfstate`.
- No `profile` in any backend block. `variable "aws_profile"` defaults to `null`. Every local Terraform and `aws` command runs with `AWS_PROFILE=personal`; every `aws` CLI command also passes `--profile personal --region us-east-1`.
- **Nothing is applied during this plan.** No `terraform apply`, no `-replace`, no `import`. A non-empty plan is fixed in code.
- **Never answer `yes` to Terraform's "copy existing state to the new backend?" prompt** and never pass `-migrate-state`. Always delete a moved directory's `.terraform/` before `init`.
- The Lambda keeps `lifecycle { ignore_changes = [image_uri] }`.
- `random_password.cookie_secret` and `random_password.owner_cognito` are moved, never recreated.
- Existing comments move verbatim with the code they describe. Only path references to `environments.tf`/`shared.tf` change.
- Resource counts: 83 managed resources in total; `shared` 59, each env 8.
- Commit messages end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>` and reference `#327`.

## Review Focus

1. **IAM list order.** If shared builds `all_lambda_function_arns` or `all_data_bucket_arns` in a different order from today (lambdas: main, dev, stage; buckets: dev, main, stage), the policy JSON may differ and plan an in-place update. Covered by Task 7's `-detailed-exitcode` check on `shared`; Task 3 writes the lists in the current order.
2. **Stale `.terraform/` after `mv infra/main infra/shared`.** It still points at `main/terraform.tfstate`, and `init` would offer to copy that state into `shared/`, producing two states managing everything. Task 3 deletes it before any `init`.
3. **Windows quoting of `["dev"]` addresses** when Git Bash passes them to `terraform.exe`. Task 6 runs the whole table with `-dry-run` first and checks the printed addresses.
4. **A Vercel env var with a changed `target` or `git_branch`** is replaced, which briefly removes `S3_BUCKET_NAME`/`LAMBDA_FUNCTION_NAME` from a deployment. Task 7's plan check catches it; Task 2 passes `git_branch = null` exactly where today's resources omit it.
5. **A stale checkout of `infra/main`** planning or applying after the split. Task 8 moves the old key aside so that such a run sees empty state.

---

### Task 1: Pre-check and backup

**Files:** none in the repo. Writes `<scratchpad>/pre-split.tfstate`.

`<scratchpad>` below is `C:/Users/ashut/AppData/Local/Temp/claude/E--Personal-looper/9e68e70b-3bfd-424a-b7c1-07c59f942930/scratchpad`. Use any directory outside the repo if running elsewhere.

- [ ] **Step 1: Confirm the current config matches reality**

```bash
cd /e/Personal/looper/infra/main
export AWS_PROFILE=personal
terraform plan -var-file=terraform.tfvars -detailed-exitcode -lock=true
echo "exit=$?"
```
Expected: `No changes.` and `exit=0`. Exit 2 means drift. Stop and report to the owner; do not continue.

- [ ] **Step 2: Back up the state**

```bash
terraform state pull > "<scratchpad>/pre-split.tfstate"
terraform state list -state="<scratchpad>/pre-split.tfstate" | grep -vc '^data\.'
```
Expected: `83`.

- [ ] **Step 3: Confirm bucket versioning**

```bash
aws s3api get-bucket-versioning --bucket bgm-looper-tf-state-223376380711 --profile personal --region us-east-1
```
Expected: `"Status": "Enabled"`.

---

### Task 2: The `environment` module

**Files:**
- Create: `infra/modules/environment/versions.tf`, `variables.tf`, `main.tf`, `outputs.tf`

**Interfaces:**
- Produces: module inputs `env` (string), `project_name` (string), `vercel_target` (list(string)), `vercel_git_branch` (string, nullable), `bootstrap_image_tag` (string); outputs `data_bucket_name`, `lambda_function_name`. Resource addresses: `aws_s3_bucket.data`, `aws_s3_bucket_public_access_block.data`, `aws_s3_bucket_cors_configuration.data`, `aws_s3_bucket_lifecycle_configuration.data`, `aws_lambda_function.this`, `aws_cloudwatch_metric_alarm.lambda_invocation_rate`, `vercel_project_environment_variable.s3_bucket`, `vercel_project_environment_variable.lambda_function_name`. These must match the mapping table in Task 5.

- [ ] **Step 1: `versions.tf`**

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.62"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 5.15"
    }
  }
}
```

- [ ] **Step 2: `variables.tf`**

```hcl
variable "env" {
  description = "main, dev or stage. main's bucket and function names carry no suffix."
  type        = string

  validation {
    condition     = contains(["main", "dev", "stage"], var.env)
    error_message = "env must be main, dev or stage."
  }
}

variable "project_name" {
  type = string
}

variable "vercel_target" {
  description = "Vercel targets for this environment's S3_BUCKET_NAME and LAMBDA_FUNCTION_NAME."
  type        = list(string)
}

variable "vercel_git_branch" {
  description = "Branch-scoped override within the preview target. Only stage sets it."
  type        = string
  default     = null
}

# Move the comment block above `variable "bootstrap_image_tag_main"` in
# infra/main/variables.tf (lines 56-61) here verbatim, changing
# "aws_lambda_function.looper/looper_env" to "aws_lambda_function.this".
variable "bootstrap_image_tag" {
  type = string
}
```
(Replace the three placeholder comment lines with the moved comment block; they are instructions, not file content.)

- [ ] **Step 3: `main.tf`**

```hcl
# Everything that exists once per branch: the branch's data bucket, Lambda function,
# its invocation alarm, and the two Vercel env vars that point the app at them.
# Shared resources (ECR, IAM, the Vercel project) live in infra/shared and are found
# here by name, so this stack never reads shared's state.

data "aws_caller_identity" "current" {}

data "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec"
}

data "aws_ecr_repository" "looper" {
  name = "${var.project_name}-lambda"
}

data "aws_sns_topic" "budget_alerts" {
  name = "${var.project_name}-budget-alerts"
}

data "vercel_project" "looper" {
  name = var.project_name
}

locals {
  # Must stay in step with local.env_suffix in infra/shared/shared.tf, which builds
  # the same names for the IAM policies and RESUME_BUCKET_NAME.
  suffix               = var.env == "main" ? "" : "-${var.env}"
  lambda_function_name = "${var.project_name}-processor${local.suffix}"

  # <moved verbatim: the app_origins comment and list, infra/main/environments.tf lines 12-30>
}

# --- S3 ---

# <moved verbatim: the comment above aws_s3_bucket.data, environments.tf lines 33-34>
resource "aws_s3_bucket" "data" {
  bucket = "portfolio-data${local.suffix}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = local.app_origins
    allowed_headers = ["*"]
  }
}

# <moved verbatim: environments.tf lines 64-68 (comment above the lifecycle resource)>
resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  # <moved verbatim: the four `rule` blocks and the trailing comment, environments.tf lines 73-114>
}

# --- Lambda ---
# Each branch's CI run updates its own function's image code — see .github/workflows/deploy.yml.

resource "aws_lambda_function" "this" {
  function_name = local.lambda_function_name
  role          = data.aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${data.aws_ecr_repository.looper.repository_url}:${var.bootstrap_image_tag}"
  timeout       = 60
  memory_size   = 1024

  lifecycle {
    ignore_changes = [image_uri]
  }
}

# --- Runaway-invoke detection ---
# <moved verbatim: environments.tf lines 159-179, without the "# --- Runaway-invoke detection ---" line already above>
resource "aws_cloudwatch_metric_alarm" "lambda_invocation_rate" {
  alarm_name          = "${local.lambda_function_name}-invocation-rate"
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  dimensions          = { FunctionName = local.lambda_function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 50
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [data.aws_sns_topic.budget_alerts.arn]
  ok_actions          = [data.aws_sns_topic.budget_alerts.arn]

  alarm_description = "More than 50 invocations of ${local.lambda_function_name} in five minutes. Normal use is one invocation per track processed, so this means a runaway loop. See docs/runbooks/incident-tool-down.md#rollback."
}

# --- Vercel env vars: production target -> main, bare preview -> dev,
#     preview + git_branch "stage" -> stage. ---

resource "vercel_project_environment_variable" "s3_bucket" {
  project_id = data.vercel_project.looper.id
  key        = "S3_BUCKET_NAME"
  value      = aws_s3_bucket.data.bucket
  target     = var.vercel_target
  git_branch = var.vercel_git_branch
  sensitive  = false
}

resource "vercel_project_environment_variable" "lambda_function_name" {
  project_id = data.vercel_project.looper.id
  key        = "LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.this.function_name
  target     = var.vercel_target
  git_branch = var.vercel_git_branch
  sensitive  = false
}
```
Every `<moved verbatim: …>` line is replaced by the named lines from `infra/main/environments.tf` as they are at commit `6a4b2ee`. The `depends_on` on the exec role's policies is dropped (spec §5.1). The comment on the lifecycle resource that says "in shared.tf" becomes "in infra/shared/shared.tf". The SNS data source name and the ECR name `${var.project_name}-lambda` are taken from `shared.tf` lines 45 and 560.

- [ ] **Step 4: `outputs.tf`**

```hcl
output "data_bucket_name" {
  value = aws_s3_bucket.data.bucket
}

output "lambda_function_name" {
  value = aws_lambda_function.this.function_name
}
```

- [ ] **Step 5: Validate**

```bash
cd /e/Personal/looper/infra/modules/environment
terraform fmt -check && terraform init -backend=false >/dev/null && terraform validate
rm -rf .terraform .terraform.lock.hcl
```
Expected: `Success! The configuration is valid.`

- [ ] **Step 6: Commit**

```bash
cd /e/Personal/looper
git add infra/modules/environment
git commit -m "chore(infra): add the per-environment Terraform module

Refs #327

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 3: `infra/shared` (from `infra/main`)

**Files:**
- Move: `infra/main/` → `infra/shared/` (tracked and untracked files, including `terraform.tfvars`)
- Delete: `infra/shared/environments.tf`, `infra/shared/.terraform/`
- Modify: `infra/shared/backend.tf`, `shared.tf`, `variables.tf`, `outputs.tf`

**Interfaces:**
- Consumes: the naming rule of Task 2 (`portfolio-data${suffix}-<acct>`, `${project_name}-processor${suffix}`).
- Produces: shared resources at the same addresses as today; outputs `ecr_repository_url`, `vercel_project_id`, `protection_bypass_secret`, `ci_deploy_role_arn`.

- [ ] **Step 1: Move the directory and drop its backend cache**

```bash
cd /e/Personal/looper
mv infra/main infra/shared
rm -rf infra/shared/.terraform
git rm -q infra/shared/environments.tf 2>/dev/null || rm infra/shared/environments.tf
git add -A infra/main infra/shared
```
`infra/shared/.terraform/` must be gone before any `init` in this directory (Review Focus 2).

- [ ] **Step 2: `backend.tf`** — change the backend block to:

```hcl
  backend "s3" {
    bucket       = "bgm-looper-tf-state-223376380711"
    key          = "shared/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
```
`required_version` and `required_providers` stay as they are.

- [ ] **Step 3: `shared.tf` locals** — replace lines 27-38 (from `lambda_function_name =` to `all_data_bucket_arns = …`) with:

```hcl
  # Per-environment names, built from the same rule as infra/modules/environment so
  # this stack never reads an env stack's state. The list orders match what the
  # policies used before the split (lambdas main/dev/stage, buckets dev/main/stage).
  env_suffix = { main = "", dev = "-dev", stage = "-stage" }

  lambda_function_names = { for e, s in local.env_suffix : e => "${var.project_name}-processor${s}" }
  data_bucket_names     = { for e, s in local.env_suffix : e => "portfolio-data${s}-${data.aws_caller_identity.current.account_id}" }

  all_lambda_function_arns = [
    for e in ["main", "dev", "stage"] :
    "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.lambda_function_names[e]}"
  ]
  all_data_bucket_arns = [for e in ["dev", "main", "stage"] : "arn:aws:s3:::${local.data_bucket_names[e]}"]
```
`all_lambda_function_names` is deleted; its only user was the alarm, now in the module.

- [ ] **Step 4: `shared.tf` resume bucket references**

In the `locals` block above the GitHub OIDC provider:
```hcl
  resume_bucket_arn = "arn:aws:s3:::${local.data_bucket_names["main"]}"
```
In `vercel_project_environment_variable.resume_bucket_name`:
```hcl
  value      = local.data_bucket_names["main"]
```

- [ ] **Step 5: `shared.tf` comments** — the three references to `environments.tf` (lines 4, 41, 267) become `infra/modules/environment`. Line 1-4's header now describes this stack as "applied from main only; per-environment resources live in infra/modules/environment".

- [ ] **Step 6: `variables.tf`**
- `aws_profile`: `default = null`; description becomes `"Named AWS CLI profile. Null (the default) uses the environment: AWS_PROFILE locally, OIDC credentials in CI."`
- Delete the comment block and the three `bootstrap_image_tag_*` variables (lines 56-75); they moved to the module and the env roots.

- [ ] **Step 7: `outputs.tf`** — delete the `data_bucket_name` and `lambda_function_name` outputs.

- [ ] **Step 8: Find leftover references**

```bash
cd /e/Personal/looper/infra/shared
grep -n 'aws_s3_bucket\.\|aws_lambda_function\.\|bootstrap_image_tag\|all_lambda_function_names\|environments\.tf' *.tf
```
Expected: no output.

- [ ] **Step 9: Validate**

```bash
terraform fmt -check && terraform init -backend=false >/dev/null && terraform validate
rm -rf .terraform
```
Expected: `Success! The configuration is valid.` (Remove `.terraform` again: `-backend=false` init must not linger before Task 7's real init.)

- [ ] **Step 10: Commit**

```bash
cd /e/Personal/looper
git add -A infra/main infra/shared
git commit -m "chore(infra): turn infra/main into the shared stack

Refs #327

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 4: `infra/envs/{dev,stage,main}`

**Files:**
- Create, for each `<env>` in `dev`, `stage`, `main`: `infra/envs/<env>/backend.tf`, `providers.tf`, `variables.tf`, `main.tf`, `outputs.tf`, `terraform.tfvars.example`, `.terraform.lock.hcl` (copied)
- Create (gitignored, not committed): `infra/envs/<env>/terraform.tfvars`

**Interfaces:**
- Consumes: Task 2's module inputs and outputs.

Per-env values:

| `<env>` | `vercel_target` | `vercel_git_branch` | `bootstrap_image_tag` |
|---|---|---|---|
| dev | `["preview"]` | `null` | `"dev-bdf04bfd483a13b26cb30e6a89dacc5d14101e4a"` |
| stage | `["preview"]` | `"stage"` | `"stage-0139b7ba435c89c79dc8c88bf6feb79f628753bb"` |
| main | `["production"]` | `null` | `"main-a61a6a20eb4f0f84b6cf292d25a0d0b5046f8f2e"` |

- [ ] **Step 1: `backend.tf`** (shown for dev; stage and main change only `key`)

```hcl
terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "bgm-looper-tf-state-223376380711"
    key          = "envs/dev/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.62"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 5.15"
    }
  }
}
```

- [ ] **Step 2: `providers.tf`** (identical in all three)

```hcl
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

provider "vercel" {
  api_token = var.vercel_api_token
}
```

- [ ] **Step 3: `variables.tf`** (identical in all three)

```hcl
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  description = "Named AWS CLI profile. Null (the default) uses the environment: AWS_PROFILE locally, OIDC credentials in CI."
  type        = string
  default     = null
}

variable "project_name" {
  type    = string
  default = "bgm-looper"
}

variable "vercel_api_token" {
  type      = string
  sensitive = true
}
```

- [ ] **Step 4: `main.tf`** (shown for stage; use the table for the others)

```hcl
# The stage environment: its bucket, Lambda, alarm and Vercel env vars.
# Apply infra/shared first on a fresh build — this stack looks up its resources by name.
module "environment" {
  source = "../../modules/environment"

  env               = "stage"
  project_name      = var.project_name
  vercel_target     = ["preview"]
  vercel_git_branch = "stage"

  # Only read when the function is first created; see the module's variable comment.
  bootstrap_image_tag = "stage-0139b7ba435c89c79dc8c88bf6feb79f628753bb"
}
```

- [ ] **Step 5: `outputs.tf`** (identical in all three)

```hcl
output "data_bucket_name" {
  value = module.environment.data_bucket_name
}

output "lambda_function_name" {
  value = module.environment.lambda_function_name
}
```

- [ ] **Step 6: `terraform.tfvars.example`** (identical in all three)

```hcl
# Copy to terraform.tfvars (gitignored via *.tfvars). The env stacks need only the
# Vercel token; every other secret belongs to infra/shared.
vercel_api_token = "..."
```

- [ ] **Step 7: Local tfvars and lock files**

```bash
cd /e/Personal/looper/infra
for e in dev stage main; do
  grep '^vercel_api_token' shared/terraform.tfvars > envs/$e/terraform.tfvars
  cp shared/.terraform.lock.hcl envs/$e/.terraform.lock.hcl
done
```

- [ ] **Step 8: Validate**

```bash
for e in dev stage main; do
  (cd envs/$e && terraform fmt -check && terraform init -backend=false >/dev/null && terraform validate && rm -rf .terraform)
done
```
Expected: `Success! The configuration is valid.` three times. If `init` rewrote a lock file to drop the unused `random` entry, keep the rewritten file.

- [ ] **Step 9: Commit**

```bash
cd /e/Personal/looper
git add infra/envs
git status --short infra/envs | grep tfvars$ && echo "STOP: tfvars staged"
git commit -m "chore(infra): add dev, stage and main environment stacks

Refs #327

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```
Expected: no `STOP` line (`terraform.tfvars` is gitignored; `.example` is committed).

---

### Task 5: Mapping table and migration script — owner review gate

**Files:**
- Create: `infra/migration/state-map.tsv`, `infra/migration/split-state.sh`

**Interfaces:**
- Produces: `split-state.sh <old.tfstate> <out_dir>` writes `<out_dir>/{shared,envs-dev,envs-stage,envs-main}.tfstate`. `DRY_RUN=1` passes `-dry-run` to every move.

- [ ] **Step 1: `state-map.tsv`** — tab-separated `from`, `stack`, `to`; 83 rows, generated from `terraform state list` on 2026-10-01:

```
aws_cloudwatch_metric_alarm.lambda_invocation_rate["bgm-looper-processor-dev"]	envs/dev	module.environment.aws_cloudwatch_metric_alarm.lambda_invocation_rate
aws_lambda_function.looper_env["dev"]	envs/dev	module.environment.aws_lambda_function.this
aws_s3_bucket.data["dev"]	envs/dev	module.environment.aws_s3_bucket.data
aws_s3_bucket_cors_configuration.data["dev"]	envs/dev	module.environment.aws_s3_bucket_cors_configuration.data
aws_s3_bucket_lifecycle_configuration.data["dev"]	envs/dev	module.environment.aws_s3_bucket_lifecycle_configuration.data
aws_s3_bucket_public_access_block.data["dev"]	envs/dev	module.environment.aws_s3_bucket_public_access_block.data
vercel_project_environment_variable.lambda_function_name_preview	envs/dev	module.environment.vercel_project_environment_variable.lambda_function_name
vercel_project_environment_variable.s3_bucket_preview	envs/dev	module.environment.vercel_project_environment_variable.s3_bucket
aws_cloudwatch_metric_alarm.lambda_invocation_rate["bgm-looper-processor"]	envs/main	module.environment.aws_cloudwatch_metric_alarm.lambda_invocation_rate
aws_lambda_function.looper	envs/main	module.environment.aws_lambda_function.this
aws_s3_bucket.data["main"]	envs/main	module.environment.aws_s3_bucket.data
aws_s3_bucket_cors_configuration.data["main"]	envs/main	module.environment.aws_s3_bucket_cors_configuration.data
aws_s3_bucket_lifecycle_configuration.data["main"]	envs/main	module.environment.aws_s3_bucket_lifecycle_configuration.data
aws_s3_bucket_public_access_block.data["main"]	envs/main	module.environment.aws_s3_bucket_public_access_block.data
vercel_project_environment_variable.lambda_function_name_production	envs/main	module.environment.vercel_project_environment_variable.lambda_function_name
vercel_project_environment_variable.s3_bucket_production	envs/main	module.environment.vercel_project_environment_variable.s3_bucket
aws_cloudwatch_metric_alarm.lambda_invocation_rate["bgm-looper-processor-stage"]	envs/stage	module.environment.aws_cloudwatch_metric_alarm.lambda_invocation_rate
aws_lambda_function.looper_env["stage"]	envs/stage	module.environment.aws_lambda_function.this
aws_s3_bucket.data["stage"]	envs/stage	module.environment.aws_s3_bucket.data
aws_s3_bucket_cors_configuration.data["stage"]	envs/stage	module.environment.aws_s3_bucket_cors_configuration.data
aws_s3_bucket_lifecycle_configuration.data["stage"]	envs/stage	module.environment.aws_s3_bucket_lifecycle_configuration.data
aws_s3_bucket_public_access_block.data["stage"]	envs/stage	module.environment.aws_s3_bucket_public_access_block.data
vercel_project_environment_variable.lambda_function_name_stage	envs/stage	module.environment.vercel_project_environment_variable.lambda_function_name
vercel_project_environment_variable.s3_bucket_stage	envs/stage	module.environment.vercel_project_environment_variable.s3_bucket
aws_acm_certificate.auth	shared	aws_acm_certificate.auth
aws_acm_certificate_validation.auth	shared	aws_acm_certificate_validation.auth
aws_budgets_budget.project	shared	aws_budgets_budget.project
aws_cognito_identity_provider.google	shared	aws_cognito_identity_provider.google
aws_cognito_managed_login_branding.web	shared	aws_cognito_managed_login_branding.web
aws_cognito_user.owner	shared	aws_cognito_user.owner
aws_cognito_user_pool.owner	shared	aws_cognito_user_pool.owner
aws_cognito_user_pool_client.web	shared	aws_cognito_user_pool_client.web
aws_cognito_user_pool_domain.custom	shared	aws_cognito_user_pool_domain.custom
aws_ecr_lifecycle_policy.looper	shared	aws_ecr_lifecycle_policy.looper
aws_ecr_repository.looper	shared	aws_ecr_repository.looper
aws_iam_openid_connect_provider.github	shared	aws_iam_openid_connect_provider.github
aws_iam_openid_connect_provider.vercel	shared	aws_iam_openid_connect_provider.vercel
aws_iam_role.ci_deploy	shared	aws_iam_role.ci_deploy
aws_iam_role.lambda_exec	shared	aws_iam_role.lambda_exec
aws_iam_role.vercel	shared	aws_iam_role.vercel
aws_iam_role_policy.ci_deploy	shared	aws_iam_role_policy.ci_deploy
aws_iam_role_policy.lambda_s3	shared	aws_iam_role_policy.lambda_s3
aws_iam_role_policy.vercel	shared	aws_iam_role_policy.vercel
aws_iam_role_policy_attachment.lambda_basic	shared	aws_iam_role_policy_attachment.lambda_basic
aws_sesv2_email_identity.domain	shared	aws_sesv2_email_identity.domain
aws_sesv2_email_identity.owner	shared	aws_sesv2_email_identity.owner
aws_sesv2_email_identity_mail_from_attributes.domain	shared	aws_sesv2_email_identity_mail_from_attributes.domain
aws_sesv2_email_identity_policy.cognito	shared	aws_sesv2_email_identity_policy.cognito
aws_sns_topic.budget_alerts	shared	aws_sns_topic.budget_alerts
aws_sns_topic_policy.budget_alerts	shared	aws_sns_topic_policy.budget_alerts
aws_sns_topic_subscription.budget_alerts_email	shared	aws_sns_topic_subscription.budget_alerts_email
random_password.cookie_secret	shared	random_password.cookie_secret
random_password.owner_cognito	shared	random_password.owner_cognito
vercel_dns_record.apex_spf	shared	vercel_dns_record.apex_spf
vercel_dns_record.auth	shared	vercel_dns_record.auth
vercel_dns_record.auth_acm["auth.ashutosh-pandey.com"]	shared	vercel_dns_record.auth_acm["auth.ashutosh-pandey.com"]
vercel_dns_record.caa_amazon	shared	vercel_dns_record.caa_amazon
vercel_dns_record.dmarc	shared	vercel_dns_record.dmarc
vercel_dns_record.mail_from_mx	shared	vercel_dns_record.mail_from_mx
vercel_dns_record.mail_from_spf	shared	vercel_dns_record.mail_from_spf
vercel_dns_record.ses_dkim[0]	shared	vercel_dns_record.ses_dkim[0]
vercel_dns_record.ses_dkim[1]	shared	vercel_dns_record.ses_dkim[1]
vercel_dns_record.ses_dkim[2]	shared	vercel_dns_record.ses_dkim[2]
vercel_firewall_config.looper	shared	vercel_firewall_config.looper
vercel_project.looper	shared	vercel_project.looper
vercel_project_domain.custom	shared	vercel_project_domain.custom
vercel_project_domain.custom_branch["dev"]	shared	vercel_project_domain.custom_branch["dev"]
vercel_project_domain.custom_branch["stage"]	shared	vercel_project_domain.custom_branch["stage"]
vercel_project_domain.custom_www	shared	vercel_project_domain.custom_www
vercel_project_environment_variable.app_password	shared	vercel_project_environment_variable.app_password
vercel_project_environment_variable.aws_region	shared	vercel_project_environment_variable.aws_region
vercel_project_environment_variable.aws_role_arn	shared	vercel_project_environment_variable.aws_role_arn
vercel_project_environment_variable.cognito_client_id	shared	vercel_project_environment_variable.cognito_client_id
vercel_project_environment_variable.cognito_domain	shared	vercel_project_environment_variable.cognito_domain
vercel_project_environment_variable.cognito_user_pool_id	shared	vercel_project_environment_variable.cognito_user_pool_id
vercel_project_environment_variable.cookie_secret	shared	vercel_project_environment_variable.cookie_secret
vercel_project_environment_variable.news_desk_model	shared	vercel_project_environment_variable.news_desk_model
vercel_project_environment_variable.openrouter_api_key	shared	vercel_project_environment_variable.openrouter_api_key
vercel_project_environment_variable.openrouter_base_url	shared	vercel_project_environment_variable.openrouter_base_url
vercel_project_environment_variable.openrouter_model	shared	vercel_project_environment_variable.openrouter_model
vercel_project_environment_variable.owner_email	shared	vercel_project_environment_variable.owner_email
vercel_project_environment_variable.resume_bucket_name	shared	vercel_project_environment_variable.resume_bucket_name
vercel_project_protection_bypass.automation	shared	vercel_project_protection_bypass.automation
```

- [ ] **Step 2: `split-state.sh`**

```bash
#!/usr/bin/env bash
# One-off: splits the pre-split infra/main state into the four stacks, using
# state-map.tsv. Works on local files only; never touches the S3 backend.
# Run from an empty directory outside the repo, so Terraform uses the local backend.
set -euo pipefail

old=$1
out=$2
map="$(dirname "$0")/state-map.tsv"
dry=${DRY_RUN:+-dry-run}

mkdir -p "$out"
while IFS=$'\t' read -r from stack to; do
  [ -z "$from" ] && continue
  file="$out/${stack//\//-}.tfstate"
  terraform state mv $dry -lock=false -state="$old" -state-out="$file" "$from" "$to"
done < "$map"
```

- [ ] **Step 3: Sanity-check the table**

```bash
cd /e/Personal/looper/infra/migration
wc -l < state-map.tsv
cut -f2 state-map.tsv | sort | uniq -c
cut -f1 state-map.tsv | sort > /tmp/map-from.txt
terraform state list -state="<scratchpad>/pre-split.tfstate" | grep -v '^data\.' | sort | diff - /tmp/map-from.txt && echo "table covers state exactly"
for e in dev stage main; do awk -F'\t' -v s="envs/$e" '$2==s{print $3}' state-map.tsv | sort | uniq -d; done
```
Expected: `83`; counts `59 shared`, `8` each env; `table covers state exactly`; no duplicate target addresses.

- [ ] **Step 4: Commit and stop for the owner's review**

```bash
cd /e/Personal/looper
git add infra/migration
git commit -m "chore(infra): add the state split mapping table and script

Refs #327

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```
**STOP.** Show the owner `infra/migration/state-map.tsv` (the 24 non-shared rows in particular) and wait for explicit approval before Task 6.

---

### Task 6: Move the state locally

**Files:** none in the repo. Works in `<scratchpad>/split/`.

- [ ] **Step 1: Dry run**

```bash
mkdir -p "<scratchpad>/split" && cd "<scratchpad>/split"
cp ../pre-split.tfstate old.tfstate
DRY_RUN=1 bash /e/Personal/looper/infra/migration/split-state.sh old.tfstate out 2>&1 | tee dry-run.log
grep -c '^Would move' dry-run.log
grep 'Would move' dry-run.log | grep -E '\["(dev|main|stage)"\]' | head -3
```
Expected: `83`, and the `["dev"]`-style addresses print with their quotes intact (Review Focus 3). If an address shows mangled quotes, stop and report: do not run Step 2.

- [ ] **Step 2: Real run**

```bash
bash /e/Personal/looper/infra/migration/split-state.sh old.tfstate out
```

- [ ] **Step 3: Completeness**

```bash
terraform state list -state=old.tfstate | grep -vc '^data\.' || true
for f in out/*.tfstate; do printf '%s ' "$f"; terraform state list -state="$f" | grep -vc '^data\.'; done
terraform state list -state=out/shared.tfstate | grep random_password
```
Expected: `0` left in `old.tfstate`; `envs-dev 8`, `envs-main 8`, `envs-stage 8`, `shared 59`; both `random_password.cookie_secret` and `random_password.owner_cognito` listed.

---

### Task 7: Push and verify `No changes`

**Files:** possibly any `.tf` from Tasks 2-4, if a plan shows a diff.

- [ ] **Step 1: Push each stack**

```bash
export AWS_PROFILE=personal
S=<scratchpad>/split/out
cd /e/Personal/looper/infra/shared && terraform init -input=false && terraform state push "$S/shared.tfstate"
for e in dev stage main; do
  (cd /e/Personal/looper/infra/envs/$e && terraform init -input=false && terraform state push "$S/envs-$e.tfstate")
done
```
Expected: each `init` reports `Successfully configured the backend "s3"` with **no** prompt about existing state. A prompt means a stale `.terraform/`: answer `no`, stop and report. `state push` must succeed without `-force`.

- [ ] **Step 2: Plan all four**

```bash
cd /e/Personal/looper/infra
for d in shared envs/dev envs/stage envs/main; do
  (cd $d && terraform plan -var-file=terraform.tfvars -detailed-exitcode -input=false > "<scratchpad>/plan-${d//\//-}.txt" 2>&1; echo "$d exit=$?")
done
```
Expected: `exit=0` for all four.

- [ ] **Step 3: If any exit is 2, fix in code**

Read the plan file. Usual causes and fixes:
- Policy JSON change in `shared`: list order in Task 3 Step 3.
- Vercel env var replaced: `target`/`git_branch` in Task 4's table.
- A resource to create in an env stack and to destroy nowhere: a mapping row went to the wrong stack. Stop and report; this needs a state edit, which needs the owner.

Fix, re-run Step 2, repeat until all four exit `0`. Never run `apply`.

- [ ] **Step 4: Commit any fixes**

```bash
cd /e/Personal/looper
git add -A infra
git commit -m "fix(infra): make the split stacks plan clean

Refs #327

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```
Skip if nothing changed.

---

### Task 8: Retire the old state key

**Files:** none in the repo.

- [ ] **Step 1: Copy, then delete the old key**

```bash
B=s3://bgm-looper-tf-state-223376380711
aws s3 cp $B/main/terraform.tfstate $B/main/terraform.tfstate.pre-split --profile personal --region us-east-1
aws s3 ls $B/main/ --profile personal --region us-east-1
aws s3 rm $B/main/terraform.tfstate --profile personal --region us-east-1
aws s3 ls $B/ --recursive --profile personal --region us-east-1
```
Expected final listing: `envs/dev/…`, `envs/main/…`, `envs/stage/…`, `shared/…` and `main/terraform.tfstate.pre-split`; no `main/terraform.tfstate`.

- [ ] **Step 2: Re-plan once more**

Re-run Task 7 Step 2. Expected: four `exit=0`.

---

### Task 9: Docs, changelog, cleanup

**Files:**
- Delete: `infra/migration/` (its job is done; git history keeps it)
- Modify: `CLAUDE.md`, `.claude/rules/infra.md`, `.claude/skills/merging-a-pr/SKILL.md`, `ARCHITECTURE.md`, `README.md`, `docs/runbooks/incident-tool-down.md`, `docs/runbooks/infra-apply-teardown.md`, `CHANGELOG.md`

- [ ] **Step 1: Find every stale reference**

```bash
cd /e/Personal/looper
grep -n 'infra/main\|environments\.tf\|bootstrap_image_tag_\|Terraform is only ever applied from a workstation\|backend.tf. hardcodes' CLAUDE.md ARCHITECTURE.md README.md .claude/rules/infra.md .claude/skills/merging-a-pr/SKILL.md docs/runbooks/*.md
```

- [ ] **Step 2: Update each hit**

| Doc | Change |
|---|---|
| `CLAUDE.md` Structure | `infra/main/` bullet → `infra/shared/` (one-of-each, applied from `main`), `infra/modules/environment/`, `infra/envs/{dev,stage,main}/` (one state each). |
| `CLAUDE.md` Commands | Terraform: run from the stack's directory with `-var-file=terraform.tfvars`; `shared` needs the seven variables, each env only `vercel_api_token`; `AWS_PROFILE=personal` must be exported because no backend block names a profile. |
| `CLAUDE.md` Branching | The `infra/main/*.tf is split by shared-vs-per-branch` bullet → the four-stack layout; the "three buckets are one `aws_s3_bucket.data` for_each" sentence → one bucket per env stack. |
| `CLAUDE.md` Merging, `merging-a-pr` skill | "run `terraform plan`" → plan all four stacks and confirm each says `No changes.` |
| `.claude/rules/infra.md` | Bootstrap order → spec §8.3; "Terraform never reads `AWS_PROFILE`" → it now does, via the null `aws_profile` default; `bootstrap_image_tag_*` → `bootstrap_image_tag` in each `envs/<env>/main.tf`; `terraform output -raw protection_bypass_secret` and every `-replace=` example run from `infra/shared`; the "green CI says nothing about `infra/`" bullet keeps its meaning but plans four stacks. |
| `docs/runbooks/infra-apply-teardown.md` | Apply order and teardown order from spec §8.3. |
| `ARCHITECTURE.md`, `README.md`, `incident-tool-down.md` | Paths only. |

- [ ] **Step 3: `CHANGELOG.md`** — under `## [Unreleased]`, in the existing `### Changed` subsection (create it if absent):

```markdown
- Terraform state is split into `infra/shared` and one stack per environment under `infra/envs/` (#327). No resource changed.
```

- [ ] **Step 4: Remove the migration files and verify nothing is stale**

```bash
git rm -rq infra/migration
grep -rn 'infra/main' CLAUDE.md ARCHITECTURE.md README.md .claude docs/runbooks || echo clean
terraform fmt -check -recursive infra/
```
Expected: `clean` (specs and plans under `docs/superpowers/` keep their historical paths and are not checked), and `fmt` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(infra): point the docs at the split Terraform stacks

Closes #327

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 10: PR, merge, after-merge checks

- [ ] **Step 1: Open the PR into `dev`** with `Closes #327`. The description lists the four `No changes` plans from Task 8 Step 2 and states that the old key now lives at `main/terraform.tfstate.pre-split`.
- [ ] **Step 2: Merge** following the `merging-a-pr` skill (squash into `dev`). Merge the same day as Task 8 (spec §11).
- [ ] **Step 3: After merge**, from a fresh `git pull` of `dev`, re-run Task 7 Step 2. Expected: four `exit=0`.
- [ ] **Step 4: Smoke-check the sites** — the dev, stage and production sites load and sign in; a `lambda/`-touching push still deploys (the `ci_deploy` role is unchanged).
- [ ] **Step 5: In a week**, delete the backup:

```bash
aws s3 rm s3://bgm-looper-tf-state-223376380711/main/terraform.tfstate.pre-split --profile personal --region us-east-1
```
