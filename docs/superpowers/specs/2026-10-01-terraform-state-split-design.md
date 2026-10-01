# Terraform state split — Design

**Date:** 2026-10-01
**Status:** Approved 2026-10-01; §12 (three phases) added the same day at the owner's request. Brainstormed with the owner on 2026-10-01; §3 records the decisions made there.
**Issue:** #327
**Phase:** 1 of 3. §12 describes all three; phases 2 and 3 get their own issue, spec and plan, and each depends on the one before.

## 1. Problem

The owner wants Terraform to run in CI the way most teams run it: `plan` on every pull request, `apply` when the PR merges, authenticated through OIDC. Today it runs only from the workstation. The owner also wants fast feedback on infra changes: a change a feature needs should be live on `dev` as soon as it merges to `dev`, without waiting for the change to be promoted to `main`.

`infra/main` keeps every resource in one state file, `main/terraform.tfstate`. That file holds main's, dev's and stage's buckets and Lambdas side by side with the shared IAM, Cognito, DNS and Vercel project. A CI apply triggered by a push to `dev` would therefore plan and apply against production resources too. Per-branch apply needs per-environment state first.

## 2. Goals and non-goals

Goals:

- Four stacks, each with its own state: `shared`, `envs/dev`, `envs/stage`, `envs/main`.
- No stack reads another stack's state. Cross-stack links use deterministic names and `data` sources.
- The migration recreates nothing. Every stack plans `No changes` against the live account before the old state is retired.
- Both stacks remain runnable from the workstation, which stays the break-glass path once CI exists.

Non-goals:

- Moving IAM permissions and Vercel env vars from `shared` into the env stacks. That is phase 2 (§12).
- The CI workflow, the `tf-plan`/`tf-apply` roles and moving the secrets into GitHub. That is phase 3 (§12).
- Separate AWS accounts per environment.
- Moving resume data out of main's bucket.
- Changing `infra/bootstrap`.
- Any resource change. The split is a refactor of code and state only.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| State layout | Split per environment, not one state applied from one branch | Matches the per-branch `dev → stage → main` promotion; lets each branch apply only its own environment. |
| Who applies `shared` | `main` only (enforced in phase 3) | Shared resources serve every environment, so they are production and take the strictest path. Phase 2 shrinks `shared` to things that rarely change, so a feature almost never waits on it. |
| What a feature's infra lives in | The env stacks, from phase 2 on | Lets a change reach `dev` on merge to `dev`. The owner asked for fast feedback over keeping each role's permissions in one file. |
| Order of the work | Split first as a pure move, then the IAM/env-var move, then CI | Phase 1 can be verified by `No changes` alone. Phase 2 changes live IAM and needs its own reviewed plan. Mixing them would hide real changes among moves. |
| Folder layout | One root directory per stack, envs calling one module | Each directory has a fixed backend key, so a local run cannot point dev's config at main's state by forgetting `init -reconfigure`. |
| Owner of `portfolio-data-<acct>` | `envs/main` | It is main's data bucket. `RESUME_BUCKET_NAME` and the IAM grants in `shared` name it by its deterministic name. Destroying `envs/main` deletes the resume data dev and stage read; that data is production's anyway. |
| Migration method | `terraform state mv` between local copies of the state, then `state push` | `moved` blocks do not cross backends. `import` blocks would need a looked-up ID for each of 83 resources, several with compound Vercel IDs. `state mv` is mechanical and leaves the old remote state untouched until the end. |

## 4. Layout

```
infra/
  bootstrap/              unchanged
  shared/                 backend key shared/terraform.tfstate
  modules/environment/    the per-environment resources
  envs/
    dev/                  backend key envs/dev/terraform.tfstate
    stage/                backend key envs/stage/terraform.tfstate
    main/                 backend key envs/main/terraform.tfstate
```

All four keys live in the existing bucket `bgm-looper-tf-state-223376380711`, with `use_lockfile = true` and no `profile` in the backend block (§7). `infra/main/` is deleted in the same PR that lands the split.

Each `envs/<env>/` holds a backend block, the two providers, and one module call. `shared/` takes over `shared.tf`, `auth.tf`, `email.tf`, `branding/`, `branding.json` and the shared outputs, with the cross-references in §6 rewritten.

## 5. What each stack owns

### 5.1 `modules/environment` (one instance per env)

Inputs: `env` (`main`/`dev`/`stage`), `vercel_target` (list), `vercel_git_branch` (string or `null`), `bootstrap_image_tag`.

| Resource in module | From (current address) |
|---|---|
| `aws_s3_bucket.data` | `aws_s3_bucket.data["<env>"]` |
| `aws_s3_bucket_public_access_block.data` | `aws_s3_bucket_public_access_block.data["<env>"]` |
| `aws_s3_bucket_cors_configuration.data` | `aws_s3_bucket_cors_configuration.data["<env>"]` |
| `aws_s3_bucket_lifecycle_configuration.data` | `aws_s3_bucket_lifecycle_configuration.data["<env>"]` |
| `aws_lambda_function.this` | main: `aws_lambda_function.looper`; dev/stage: `aws_lambda_function.looper_env["<env>"]` |
| `aws_cloudwatch_metric_alarm.lambda_invocation_rate` | `aws_cloudwatch_metric_alarm.lambda_invocation_rate["<function name>"]` |
| `vercel_project_environment_variable.s3_bucket` | `…s3_bucket_production` / `…s3_bucket_preview` / `…s3_bucket_stage` |
| `vercel_project_environment_variable.lambda_function_name` | `…lambda_function_name_production` / `…_preview` / `…_stage` |

Eight resources per env, 24 in total. In each `envs/<env>/` these sit under `module.environment.`.

Per-env inputs:

| env | `vercel_target` | `vercel_git_branch` | bucket name | function name |
|---|---|---|---|---|
| main | `["production"]` | `null` | `portfolio-data-<acct>` | `bgm-looper-processor` |
| dev | `["preview"]` | `null` | `portfolio-data-dev-<acct>` | `bgm-looper-processor-dev` |
| stage | `["preview"]` | `"stage"` | `portfolio-data-stage-<acct>` | `bgm-looper-processor-stage` |

The Lambda keeps `lifecycle { ignore_changes = [image_uri] }`; `.claude/rules/infra.md` says never to remove it. The `depends_on` on the exec role's policies is dropped, because those resources live in `shared`; on a fresh build `shared` is applied first (§8.3), which provides the same ordering. The `app_origins` CORS list moves into the module unchanged.

`bootstrap_image_tag` replaces the three `bootstrap_image_tag_*` variables; each env passes the default that `variables.tf` has today.

### 5.2 `shared`

Everything else currently in state: 59 resources, at the same address. That includes ECR and its lifecycle policy, the Lambda exec role and its policies, both OIDC providers, the `ci_deploy` and `vercel` roles and policies, the Vercel project, its domains, firewall config, protection bypass and the env-agnostic env vars (`APP_PASSWORD`, `COOKIE_SECRET`, `APP_AWS_ROLE_ARN`, `APP_AWS_REGION`, `RESUME_BUCKET_NAME`, the OpenRouter and Cognito vars), all of Cognito, ACM, SES and the Vercel DNS records, SNS and the budget, and both `random_password` resources.

`random_password.cookie_secret` and `random_password.owner_cognito` must be moved, never recreated: recreation would rotate the live cookie secret, which logs everyone out, and the Cognito owner's password.

### 5.3 Outputs

| Output | Stack |
|---|---|
| `ecr_repository_url`, `vercel_project_id`, `protection_bypass_secret`, `ci_deploy_role_arn` | `shared` |
| `data_bucket_name`, `lambda_function_name` | each `envs/<env>` (from the module) |

## 6. Cross-stack references

### 6.1 Shared → environments

`shared.tf` currently derives `all_lambda_function_arns`, `all_lambda_function_names`, `all_data_bucket_arns` and `resume_bucket_arn` from env resources. These become name-built strings in one `locals` block in `shared`:

```hcl
locals {
  account_id      = data.aws_caller_identity.current.account_id
  env_suffix      = { main = "", dev = "-dev", stage = "-stage" }
  lambda_names    = { for e, s in local.env_suffix : e => "${var.project_name}-processor${s}" }
  bucket_names    = { for e, s in local.env_suffix : e => "portfolio-data${s}-${local.account_id}" }
  lambda_arns     = [for n in values(local.lambda_names) : "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${n}"]
  bucket_arns     = [for n in values(local.bucket_names) : "arn:aws:s3:::${n}"]
  resume_bucket   = local.bucket_names["main"]
}
```

The module computes the same names from the same rule. If the two ever disagreed, the IAM policies would grant access to a name nothing uses. §8's `No changes` check catches that, because the policy documents would differ from the live ones.

### 6.2 Environments → shared

The module looks up shared resources by name with `data` sources:

| Needed | Data source |
|---|---|
| Exec role ARN | `data "aws_iam_role" "lambda_exec"` by `bgm-looper-lambda-exec` (the name in `shared.tf`) |
| ECR URL for the bootstrap image | `data "aws_ecr_repository" "looper"` |
| SNS topic ARN for alarms | `data "aws_sns_topic" "budget_alerts"` |
| Vercel project ID | `data "vercel_project" "looper"` by name |

The exact names are read from `shared.tf` at implementation time. An env stack applied before `shared` exists fails at these lookups, before creating anything.

## 7. Provider and variable changes

- **Backend blocks have no `profile`.** Backend blocks cannot take variables, and CI will authenticate with OIDC environment credentials. Locally, `AWS_PROFILE=personal` must be set: `.claude/settings.json` sets it for Claude Code; a plain shell needs `export AWS_PROFILE=personal`.
- **`var.aws_profile` defaults to `null`** in every stack, so the provider falls back to the environment. Its description stops saying Terraform is never run from CI.
- **Variables per stack.** The seven required variables today are `vercel_api_token`, `app_password`, `github_repo`, `alert_email`, `openrouter_api_key`, `google_client_id`, `google_client_secret`.
  - `shared` takes all seven, plus `aws_region`, `aws_profile`, `project_name`, `openrouter_model`, `news_desk_model`.
  - Each `envs/<env>` takes only `vercel_api_token` as required, plus `aws_region`, `aws_profile`, `project_name`.
- **`terraform.tfvars.example`** moves to `shared/` and gains a sibling in each env directory with just `vercel_api_token`. `*.tfvars` stays gitignored.

## 8. Migration

Run from the workstation in one sitting, with no other infra change in flight. The old remote state is not written until step 8.

### 8.1 Procedure

1. **Pre-check.** In `infra/main`, `terraform plan -var-file=terraform.tfvars` reports `No changes`. If it does not, stop and resolve the drift first.
2. **Backup.** `terraform state pull > <scratchpad>/pre-split.tfstate`. The state bucket has versioning enabled (`infra/bootstrap/main.tf`), which is a second copy.
3. **Code.** Write `shared/`, `modules/environment/` and `envs/*` on the branch. `infra/main` is left as is.
4. **Move.** Copy the backup to `old.tfstate`. A script reads a mapping table (one row per resource: source address, target stack, target address) and runs `terraform state mv -state=old.tfstate -state-out=<stack>.tfstate <from> <to>` for each row. The table is committed with the plan and reviewed by the owner before it runs.
5. **Completeness.** `terraform state list -state=old.tfstate` returns nothing apart from data sources. The four new files hold 59 + 8 + 8 + 8 = 83 resources, the count `terraform state list` reports today.
6. **Upload.** For each stack: `terraform init`, then `terraform state push <stack>.tfstate`. The target keys are empty, so no `-force` is needed.
7. **Verify.** `terraform plan` in `shared` and in each of `envs/dev`, `envs/stage`, `envs/main` reports `No changes`. A diff is fixed in code, never with `apply` or further state edits, and all four are re-planned. Nothing is applied at any point during the migration.
8. **Retire the old key.** Copy `main/terraform.tfstate` to `main/terraform.tfstate.pre-split`, then delete `main/terraform.tfstate`. A stale checkout running `infra/main` now sees empty state and proposes creating everything, which is obviously wrong, rather than silently managing the same resources as the new stacks. Push the PR and merge it the same day.
9. **Later.** After a week of normal use, delete `main/terraform.tfstate.pre-split`. Bucket versioning still holds it.

### 8.2 Rollback

- Before step 8: delete the four new state keys and the branch. Nothing else changed.
- After step 8: copy `main/terraform.tfstate.pre-split` back to `main/terraform.tfstate`, revert the PR, delete the four new keys.

### 8.3 Fresh build (kill-switch recreate)

Apply order becomes: `infra/bootstrap` (as today), `shared` with `-target=aws_ecr_repository.looper`, the rest of `shared`, push each branch so CI builds an image, then `envs/dev`, `envs/stage`, `envs/main`. Teardown is the reverse: the three env stacks, then `shared`. `docs/runbooks/infra-apply-teardown.md` and the bootstrap order in `.claude/rules/infra.md` are rewritten to match.

## 9. Docs to update in the same PR

- `CLAUDE.md`: Structure (`infra/main/` bullet), Commands (Terraform line, the required-variable list, `infra/main/terraform.tfvars.example`), Branching (`infra/main/*.tf is split by shared-vs-per-branch`), Merging (the `terraform plan` rule now means plan all four stacks).
- `.claude/rules/infra.md`: paths, bootstrap order, "Terraform never reads `AWS_PROFILE`", the `bootstrap_image_tag_*` instructions, and every `terraform output`/`-replace` example's directory.
- `.claude/skills/merging-a-pr/SKILL.md`: the infra rule.
- `ARCHITECTURE.md`, `README.md`, `docs/runbooks/incident-tool-down.md`, `docs/runbooks/infra-apply-teardown.md`: paths and commands.
- `CHANGELOG.md`: an `[Unreleased]` entry.

## 10. Testing

There is no automated test for Terraform in this repo, and this change adds none; CI validation is the follow-up's job. Verification is:

- `terraform fmt -check -recursive infra/` and `terraform validate` in all four stacks.
- §8.1 step 5: the old state is empty after the moves.
- §8.1 step 7: all four stacks plan `No changes` against the live account.
- After merge: a `dev` push still deploys its Lambda through `deploy.yml` (the `ci_deploy` role and its policy are unchanged), and the dev, stage and production sites still sign in and upload.

## 11. Risks

| Risk | Mitigation |
|---|---|
| A resource is left behind or moved twice | Step 5's empty-state check; `state mv` refuses to overwrite an address that already exists in the target. |
| A random password is recreated | They are in the mapping table as moves; any plan that shows them as create fails step 7. |
| Name-built ARNs differ from the real ones | Policy documents would differ from the live ones, so step 7 shows the diff. |
| Two states manage the same resources | Step 8 retires the old key before the PR is opened for merge, and the PR merges the same day. |
| A Vercel env var moves into the module with a changed `target`/`git_branch` | Vercel would replace it; step 7 shows a replacement and the code is corrected. |

## 12. The three phases

Each phase has its own issue, spec and plan. Each one starts only after the previous one is merged and verified. Phases 2 and 3 are outlined here so that phase 1's layout serves them; their own specs decide the details.

### Phase 1 — State split (this spec, #327)

Four stacks, a pure move, `No changes` everywhere. Terraform still runs only from the workstation.

### Phase 2 — Feature infra moves into the env stacks

Goal: anything a feature typically needs (an IAM permission, a Vercel env var) is declared in the env stacks, so it can be applied to `dev` alone. `shared` keeps only what rarely changes: the OIDC providers, the IAM roles themselves, Cognito, ACM, SES and DNS, the Vercel project and its domains, firewall and bypass, ECR, SNS and the budget.

Outline:

- **Per-env IAM policies on the shared roles.** Each env stack attaches an `aws_iam_role_policy` to the roles in `shared`, looked up by name, and scoped to that env's bucket and function:
  - `lambda_exec`: the env's slice of today's `lambda_s3` statement.
  - `vercel`: the env's slices of `AudioScratchObjects`, `NewsDeskObjects`, `NewsDeskMissingSnapshotIs404` and `InvokeProcessor`.
  - `ResumeObjects` and `ResumeHeadObjectNotFound` stay with main's bucket, which all three environments use. The phase 2 spec decides whether they live in `shared` or `envs/main`.
- **The swap happens in one apply per stack, ordered so no permission is ever missing:** apply the three env stacks first, which adds the per-env policies alongside the old combined ones, then remove the moved statements from `shared` and apply it. This is a real IAM change, reviewed as a plan.
- **Vercel env vars.** New env vars that a feature adds are declared in the env stacks, per target. Existing env-agnostic env vars stay in `shared` unless the phase 2 spec finds a reason to move one.
- **Known limit.** Vercel's OIDC subject distinguishes only `production` and `preview`. Dev and stage therefore sign in as the same identity, and that identity holds both dev's and stage's grants. Today the single `vercel` role trusts both subjects, so production can also use dev's and stage's grants and vice versa. Splitting it into a production role and a preview role would close that, and the phase 2 spec decides whether to.

### Phase 3 — Terraform in CI

Goal: plan on every PR that touches `infra/`, and apply on merge, authenticated with OIDC and no stored AWS keys.

Outline, from the decisions made on 2026-10-01:

- **Two roles in `shared`.** `tf-plan` trusts this repo's `pull_request` subject and has read-only access, plus write access to the `.tflock` keys. `tf-apply` trusts only the `main`, `dev` and `stage` branch refs. The `pull_request` trust reverses the comment at `shared.tf:171-175`; the owner accepted it because the repo is private with one contributor. The plan job also receives the Vercel token, which can always write, because Vercel has no read-only tokens. That is an accepted risk.
- **What runs where.**

  | Event | Plans | Applies |
  |---|---|---|
  | PR into `dev` | `envs/dev`, `shared` | — |
  | PR into `stage` | `envs/stage`, `shared` | — |
  | PR into `main` | `envs/main`, `shared` | — |
  | Push to `dev` | — | `envs/dev` |
  | Push to `stage` | — | `envs/stage` |
  | Push to `main` | — | `shared`, then `envs/main` |

- **CI minutes.** A separate workflow file with a `paths: infra/**` filter, like `promotion-guard.yml`, and all steps in one job: the repo's billing lesson is that each extra job bills a full minute.
- **No approval gate beyond the PR.** GitHub Environments with required reviewers are unavailable on a private repo without Pro. The reviewed PR plan is the gate.
- **Secrets.** The variables each stack needs become GitHub Actions secrets.
- **Checks before every plan**, in the same job, each failing the run:
  - **Lint:** `terraform fmt -check -recursive infra/`, `terraform validate` in every stack, and `tflint` with a pinned version and a committed `infra/.tflint.hcl` that enables the `terraform` ruleset (unused declarations, missing version constraints) and the `aws` plugin (invalid values such as Lambda runtimes and instance types that `validate` cannot know).
  - **Security scan of the plan.** The `test` job's Trivy step in `deploy.yml` already scans `infra/` source for HIGH/CRITICAL misconfigurations on every PR that triggers it. The Terraform job adds `trivy config` on each stack's plan exported with `terraform show -json`. The plan has variables and module inputs resolved, so it catches what a source scan cannot see. Same severity bar (HIGH/CRITICAL) and the same `.trivyignore`, one reason per entry.
- **Drift detection.** A weekly scheduled run of the same workflow runs `terraform plan -detailed-exitcode` on all four stacks with the `tf-plan` role. Exit code 2 on any stack opens an issue labelled `drift`, or comments on the open one, with the stack name and the plan summary. Exit 0 closes any open `drift` issue. Scheduled runs authenticate with the default branch's subject (`ref:refs/heads/dev`), so `tf-plan` also trusts that subject; the role is read-only, so this grants nothing that matters. Cost: about 2 billed minutes a week. Known blind spot: a deleted or unconfirmed SNS email subscription never shows as drift (`.claude/rules/infra.md`), so the drift job does not replace that check.
- **The workstation stays the break-glass path.** A local `apply` in `envs/dev` is allowed for quick iteration; the next CI apply on `dev` brings it back in line with git. If `tf-apply` ever breaks its own trust policy, recovery is a local apply of `shared`.
