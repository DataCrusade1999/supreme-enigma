# Per-environment IAM — Design (state split phase 2)

Issue: #333. Parent: #327, `2026-10-01-terraform-state-split-design.md` §12.

## 1. Problem

After the state split, every IAM grant a feature needs still lives in `infra/shared`:

- `aws_iam_role_policy.lambda_s3` gives the one shared exec role, `bgm-looper-lambda-exec`, `s3:GetObject`/`s3:PutObject` on all three data buckets. All three Lambdas assume that role.
- `aws_iam_role_policy.vercel` gives the one `bgm-looper-vercel` role every app permission on all three buckets and functions. Both production and preview deployments assume it.

So a new permission for a feature can only be tried by applying `shared`, which is applied from `main`, and it lands in production at the same moment it lands in dev. Production also holds dev's and stage's grants, and each Lambda can write to every environment's bucket.

## 2. Goals and non-goals

Goals:
- A feature's IAM grant is declared in the env stacks and can be applied to `envs/dev` alone.
- Each Lambda can reach only its own bucket.
- Production deployments can no longer use dev's or stage's grants.
- No deployment is without a permission at any point of the rollout.

Non-goals:
- Separating dev from stage on the Vercel side. Vercel's OIDC subject has only `production` and `preview`, so both deploy as the same identity (§6).
- Terraform in CI (phase 3).
- Tightening any grant beyond today's scope. Each statement keeps its current actions and prefixes, split by environment.
- Moving the env-agnostic Vercel env vars (`APP_PASSWORD`, `COOKIE_SECRET`, OpenRouter, Cognito, `RESUME_BUCKET_NAME`, `APP_AWS_REGION`) out of `shared`.

## 3. Decisions

| Question | Decision |
|---|---|
| Lambda identity | One exec role per environment, created by the module. |
| Exec role name | `bgm-looper-lambda-exec-<env>` for all three, main included. The unsuffixed name belongs to the shared role until §7 step 4 deletes it. |
| Vercel identity | Two roles in `shared`: the existing `bgm-looper-vercel` becomes production-only; a new `bgm-looper-vercel-preview` is trusted by the `preview` subject. |
| Why keep `bgm-looper-vercel` for production | Production never switches role, so the rollout cannot break it. Renaming a role replaces it. |
| Where per-env Vercel grants live | The env stacks, via the module, as an inline policy on the role for that env's target. |
| Resume grants | Stay in `shared`, as their own policy on both Vercel roles. The resume lives in main's bucket and all three environments use it on purpose (resume pipeline spec §4.1). |
| `APP_AWS_ROLE_ARN` | Two env vars in `shared`: target `production` → `bgm-looper-vercel`, target `preview` → `bgm-looper-vercel-preview`. Both roles are shared, so the env stacks never set it. |
| New per-env Vercel env vars | Declared in the module or an env root, using the existing `target`/`git_branch` pattern. No new mechanism. |

## 4. What each stack owns afterwards

### 4.1 `modules/environment` (new resources)

- `aws_iam_role.lambda_exec`: name `${project_name}-lambda-exec-${env}`, trusts `lambda.amazonaws.com` (same trust policy as today's shared role).
- `aws_iam_role_policy_attachment.lambda_basic`: `AWSLambdaBasicExecutionRole`.
- `aws_iam_role_policy.lambda_s3`: `s3:GetObject`, `s3:PutObject` on `<this env's bucket ARN>/*`.
- `aws_lambda_function.this`: `role = aws_iam_role.lambda_exec.arn`, and `depends_on` the two policies again, so a fresh build never creates a function whose role cannot yet read S3. The `data "aws_iam_role" "lambda_exec"` lookup is deleted.
- `aws_iam_role_policy.vercel`: name `${project_name}-vercel-${env}`, on the role looked up by name: `${project_name}-vercel` when `vercel_target` contains `production`, else `${project_name}-vercel-preview`. Statements, each scoped to this env's bucket and function only, with today's Sids and actions:
  - `AudioScratchObjects`: `s3:PutObject`, `s3:GetObject` on `uploads/*`, `outputs/*`.
  - `NewsDeskObjects`: `s3:PutObject`, `s3:GetObject` on `news-desk/*`.
  - `NewsDeskMissingSnapshotIs404`: `s3:ListBucket` on the bucket ARN, with today's comment.
  - `InvokeProcessor`: `lambda:InvokeFunction` on this env's function ARN.

Each env stack goes from 8 to 12 resources.

### 4.2 `shared`

Added:
- `aws_iam_role.vercel_preview`: name `${project_name}-vercel-preview`, same federated principal and `aud` condition as `vercel`, `sub` = the `preview` subject only.
- `aws_iam_role_policy.vercel_resume` (`${project_name}-vercel-resume`) and `aws_iam_role_policy.vercel_preview_resume` (`${project_name}-vercel-preview-resume`): one per role, holding `ResumeObjects` and `ResumeHeadObjectNotFound` exactly as today, with their comments.
- `vercel_project_environment_variable.aws_role_arn_preview`: `APP_AWS_ROLE_ARN`, target `["preview"]`, value `aws_iam_role.vercel_preview.arn`, `depends_on` the production one (below) so Vercel never sees two overlapping `preview` values.

Changed:
- `vercel_project_environment_variable.aws_role_arn`: target `["production"]` only. The plan must show this as an in-place update. If it shows a replacement, stop: replacing it would remove production's `APP_AWS_ROLE_ARN` for the length of the apply.

Removed (PR B only, §7 step 4):
- `aws_iam_role_policy.vercel` (the combined policy).
- The `preview` entry in `aws_iam_role.vercel`'s trust policy.
- `aws_iam_role.lambda_exec`, `aws_iam_role_policy_attachment.lambda_basic`, `aws_iam_role_policy.lambda_s3`.

`local.all_data_bucket_arns` loses its last user once the combined policies go and is deleted with them. `local.all_lambda_function_arns` stays: `ci_deploy` uses it.

### 4.3 Name lookups the env stacks gain

`data "aws_iam_role"` for `bgm-looper-vercel` or `bgm-looper-vercel-preview`, chosen by `vercel_target`. `envs/dev` and `envs/stage` therefore depend on `shared` having created the preview role first (§7 step 1). On a fresh build the order stays `shared`, then the env stacks.

## 5. Policy sizes

Inline policies on one role share a 10,240-character limit. The preview role will hold three inline policies (resume, dev, stage), each well under 2,000 characters. No risk.

## 6. Known limit

Dev and stage both assume `bgm-looper-vercel-preview`, so each holds the other's grants: a stage deployment can read dev's bucket and invoke dev's Lambda. This is the same as today for those two, and better than today for production. Closing it needs a per-branch identity from Vercel, which does not exist.

## 7. Rollout

Two PRs into `dev`, applied from the workstation. Each step is planned and its IAM diff read before applying.

1. **PR A, `shared`.** Apply: preview role, both resume policies, `APP_AWS_ROLE_ARN` narrowed to production plus the new preview one. Expected plan: 4 to add, 1 to change, 0 to destroy. The combined `vercel` policy and the two-subject trust stay, so every deployment keeps its permissions.
2. **PR A, env stacks.** Apply `envs/dev`, check (step 3's dev checks), then `envs/stage`, then `envs/main`. Expected per stack: 4 to add (role, two attachments/policies, Vercel policy), 1 to change (the function's `role`), 0 to destroy. The function switches to a role that already has its policies, in the same apply.
3. **Redeploy dev and stage, then check.** A Vercel env var change reaches a deployment only through a new build. Redeploy the current `dev` and `stage` deployments, then on each: process one track in the looper, open the News Desk, open `/resume` and the resume admin. On production, which did not change role: the same three checks. Confirm each function's role with `aws lambda get-function-configuration --function-name <fn> --query Role --profile personal --region us-east-1`.
4. **PR B, `shared`.** Remove the combined `vercel` policy, the `preview` subject from `bgm-looper-vercel`'s trust, and the old exec role with its two policies. Expected plan: 0 to add, 1 to change (trust policy), 4 to destroy. IAM deletes the old role only once no function uses it, which step 2 guarantees. Repeat step 3's checks on all three.

PR A merges after step 3 passes; PR B is opened after PR A merges. Promote both to `main` promptly: until they reach it, a `shared` plan from `main` shows these changes as drift.

### 7.1 Rollback

- **After step 1 or 2, before step 4:** nothing has been removed. Revert the env stacks' function `role` to `bgm-looper-lambda-exec` and apply; set the preview `APP_AWS_ROLE_ARN` to `bgm-looper-vercel`'s ARN and redeploy. Then revert PR A.
- **After step 4:** re-add the removed statements and trust entry (revert PR B) and apply `shared`.

## 8. Testing

- `terraform fmt -check`, `validate` on every stack.
- Each step's plan matches the expected add/change/destroy counts above, and the policy JSON in it names only the env's own bucket and function.
- Step 3's checks on all three environments, after steps 2 and 4.
- After step 4, `aws iam list-role-policies --role-name bgm-looper-vercel` lists only `bgm-looper-vercel-resume` and `bgm-looper-vercel-main`, and `bgm-looper-vercel-preview` lists the resume policy, `-dev` and `-stage`.

## 9. Docs to update

- `CLAUDE.md`: Branching (the exec role is per environment; "All three share one IAM exec role" goes).
- `.claude/rules/infra.md`: the IAM bullet (two Vercel roles, per-env exec roles, where a feature's grant goes), and the known limit in §6.
- `docs/runbooks/infra-apply-teardown.md`: kill-switch "What goes" list.
- Phase 1 spec §12 phase 2 outline: a pointer to this spec.
- `CHANGELOG.md`: one `[Unreleased]` entry per PR.

## 10. Risks

- **Preview role missing when an env stack applies.** Step 1 must be applied before step 2. The env stacks' `data` lookup fails loudly if it is not, so the failure is a plan error, not a missing permission.
- **`APP_AWS_ROLE_ARN` replaced instead of updated.** Covered in §4.2: the plan is checked, and a replace stops the rollout.
- **A preview deployment built between step 1 and step 3** gets the preview role, which by then has the resume policy but not yet the env policies (until step 2). Steps 1 and 2 run back to back with no push to `dev` or `stage` in between.
- **A drift report from `main`** until both PRs are promoted (§7).
