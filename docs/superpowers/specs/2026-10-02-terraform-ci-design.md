# Terraform in CI — Design (state split phase 3)

Issue: #339. Parent: #327, `2026-10-01-terraform-state-split-design.md` §12. Builds on #333 (`2026-10-01-per-env-iam-design.md`).

## 1. Problem

Every Terraform plan and apply runs on the owner's workstation. `CLAUDE.md` and the `merging-a-pr` skill make "run `terraform plan` in all four stacks before merging" a manual merge gate, because CI validates nothing under `infra/`. An infra change reaches `dev` only when someone applies it by hand, and nothing notices when the live account drifts from git.

## 2. Goals and non-goals

Goals:
- Every PR that touches `infra/` gets lint and a plan of the stacks it affects, posted on the PR; its security scan is the existing Trivy filesystem scan in `deploy.yml` (§4.1).
- Merging applies: `dev` → `envs/dev`, `stage` → `envs/stage`, `main` → `shared` then `envs/main`.
- No destroy or replace is applied without a deliberate, separate act.
- Drift is detected weekly and tracked as an issue.
- OIDC only. No long-lived AWS credentials. Code that has only reached `dev` cannot change production's AWS resources or state.
- Stays well inside the 2,000 free Actions minutes.

Non-goals:
- Multi-account (on hold, separate design).
- A reviewer approval gate. GitHub environments are not available on a private repo without Pro (§9).
- Splitting the Vercel token by environment. Vercel's token is account-wide.
- Applying `infra/bootstrap` from CI. It stays a manual, one-off stack.

## 3. Decisions

| Question | Decision |
|---|---|
| Secrets | GitHub Actions repository secrets, passed as `TF_VAR_*`. |
| Production gate | Merge is the approval; a plan that deletes anything stops and needs a manual `workflow_dispatch` typed `apply-destroys`. Same rule on every branch. |
| Job layout | One workflow, `infra/**` path filter, one job per event. |
| Apply identity | Two apply roles: `tf-apply-prod` (main) and `tf-apply-nonprod` (dev, stage), scoped by resource name. |
| Plan identity | One read-only `tf-plan` role for PRs and the scheduled drift run. |
| Bootstrap | The three roles live in `infra/shared`, created by one local apply; CI manages them afterwards. |

## 4. Workflow: `.github/workflows/terraform.yml`

Triggers:
- `pull_request` into `dev`, `stage`, `main`, `paths: ["infra/**", ".github/workflows/terraform.yml"]`.
- `push` to `dev`, `stage`, `main`, same paths.
- `schedule`: weekly, Monday 03:30 UTC.
- `workflow_dispatch` with inputs `stack` (`shared`, `envs/dev`, `envs/stage`, `envs/main`, `drift`) and `confirm` (string).

Top-level `permissions: {}`; each job grants only what it needs (`id-token: write`, `contents: read`, plus `pull-requests: write` for the PR comment or `issues: write` for drift).

`concurrency`: PRs `terraform-pr-<number>` with `cancel-in-progress: true`; applies `terraform-apply-<branch>` with `cancel-in-progress: false`; drift `terraform-drift`.

Shared setup in every job: `actions/checkout`, `hashicorp/setup-terraform` (pinned by SHA, `terraform_version: 1.15.1`, `terraform_wrapper: false`), `actions/cache` on `~/.terraform.d/plugin-cache` keyed on the hash of every `.terraform.lock.hcl`, `TF_PLUGIN_CACHE_DIR` set, `aws-actions/configure-aws-credentials` (already used by `deploy.yml`) with the job's role, `TF_IN_AUTOMATION=1`, `TF_INPUT=0`. Every action is pinned by full SHA with a version comment, as in `deploy.yml`.

Which stacks an event touches:

| Event | Stacks | Role |
|---|---|---|
| PR into `dev` / `stage` / `main` | `shared`, `envs/<base branch>` | `tf-plan` |
| push to `dev` / `stage` | `envs/<branch>` | `tf-apply-nonprod` |
| push to `main` | `shared`, then `envs/main` | `tf-apply-prod` |
| schedule | all four | `tf-plan` |
| `workflow_dispatch` | the `stack` input, which must match the ref: `envs/dev` on `dev`, `envs/stage` on `stage`, `shared`/`envs/main` on `main`; `drift` runs §4.4 and only from `dev`, since `tf-plan` trusts no other branch (the job checks out each branch itself) | `tf-apply-prod` on `main`, `tf-apply-nonprod` on `dev`/`stage`, `tf-plan` for `drift` |

### 4.1 PR job (`plan`)

1. `terraform fmt -check -recursive infra/`.
2. `tflint --init` then `tflint --recursive --config "$GITHUB_WORKSPACE/infra/.tflint.hcl"` (`terraform-linters/setup-tflint`, pinned). `infra/.tflint.hcl` enables the `terraform` ruleset (`recommended` preset) and the `aws` plugin.
3. For each stack (on a PR into `dev`, `shared` is planned from `dev`'s code, so the comment previews what `main` will eventually apply): `terraform init -lockfile=readonly`, `terraform validate`, `terraform plan -lock=false -out=<stack>.tfplan -detailed-exitcode`, `terraform show -json <stack>.tfplan > <stack>.json`, `terraform show -no-color <stack>.tfplan > <stack>.txt`. `-lock=false`: a PR plan is read-only, and the plan role can then avoid writing lock files on PRs.
4. No Trivy step. A plan scan was built and dropped in #339: `deploy.yml`'s `test` job already runs a Trivy filesystem scan, with misconfiguration checks, over `infra/*.tf` on every PR, and on #340 both scans reported the same `AWS-0345` findings. The plan scan also read the live policy from state, so a fixed `.tf` kept failing until the fix was applied.
5. One PR comment, rewritten on every run that is not cancelled (found by a hidden marker line), titled with the head commit and marked incomplete when lint or plan failed, so a stale `⚠` line never survives a later push. Per stack: `No changes`, or the add/change/destroy counts and the plan text in a collapsed block, truncated to GitHub's 65,536-character comment limit with a pointer to the job summary. The same text goes to `$GITHUB_STEP_SUMMARY`. A plan that would destroy or replace anything gets a heading line `⚠ destroys or replaces: <addresses>` so it is visible before merge.
6. The job fails on `fmt`, `tflint`, `validate` or a plan error. A non-empty plan is not a failure.

### 4.2 Apply job (`apply`, on push)

For each stack in order:
1. `terraform init -lockfile=readonly`, `terraform plan -out=<stack>.tfplan -detailed-exitcode`.
2. Exit 0: skip. Exit 2: compute `jq '[.resource_changes[] | select(.change.actions | index("delete"))] | length'` on `terraform show -json`.
3. Zero deletes: `terraform apply <stack>.tfplan`.
4. Any delete (this covers replace, which is `["delete","create"]` or `["create","delete"]`): do not apply. Write the plan and the addresses to the job summary, fail the job with `Plan deletes or replaces N resources; apply with workflow_dispatch stack=<stack> confirm=apply-destroys`, and stop before the next stack. On `main`, `envs/main` is not applied if `shared` stopped.

### 4.3 Manual apply (`workflow_dispatch`)

Runs §4.2 for the one `stack` input on the ref it was dispatched from, with step 4 replaced: if `confirm == "apply-destroys"`, apply the plan anyway; otherwise behave as §4.2. A dispatch whose `stack` does not match its ref (table above) fails before planning, so a stack is only ever applied from the branch that owns it. The plan is made fresh in the dispatched run, and its summary lists what was applied.

### 4.4 Drift job (`schedule`)

Runs on `dev` (the default branch, where `schedule` runs) with `tf-plan` and `-lock=false`, and plans each stack from the branch that applies it: `envs/dev` from `dev`, `envs/stage` from `stage`, `shared` and `envs/main` from `main` (one `actions/checkout` per branch into its own directory). Planning `shared` from `dev` would report every unpromoted change as drift. The token's subject is the workflow's ref, `dev`, whichever branch is checked out.

Result:
- Any stack exit 2: find the open issue labelled `drift` (`gh issue list --label drift --state open`). Comment on it with the per-stack summary, or create it (`chore(infra): drift detected`, labels `drift`, `area: infra`).
- All exit 0: close any open `drift` issue with a comment naming the run.
- Exit 1 (error): the job fails; no issue change. A failed scheduled run emails the owner, which is the signal.

The SNS email subscription blind spot (`.claude/rules/infra.md`) is unchanged: drift detection cannot see it.

## 5. Secrets and variables

Repository secrets (Settings → Secrets → Actions): `TF_VAR_VERCEL_API_TOKEN`, `TF_VAR_APP_PASSWORD`, `TF_VAR_OPENROUTER_API_KEY`, `TF_VAR_GOOGLE_CLIENT_SECRET`.
Repository variables: `TF_VAR_GITHUB_REPO`, `TF_VAR_ALERT_EMAIL`, `TF_VAR_GOOGLE_CLIENT_ID`.

The workflow maps them to lower-case `TF_VAR_<name>` env vars. Env stacks get only `TF_VAR_vercel_api_token`. The `terraform.tfvars` files stay local, gitignored, and are not used in CI.

Fork PRs: GitHub does not issue an OIDC token or repository secrets to workflows from fork PRs while "Send write tokens / secrets to workflows from fork pull requests" stays off (the default for private repos). The repo must keep that off; `.claude/rules/infra.md` records it.

## 6. Roles (in `infra/shared`, new file `ci.tf`)

All three trust `aws_iam_openid_connect_provider.github`, `aud = sts.amazonaws.com`, `StringEquals` on `sub` built from `local.github_sub_prefix`.

### 6.1 `bgm-looper-tf-plan`

- Trust: `<prefix>:pull_request`, and `<prefix>:ref:refs/heads/dev` for the schedule. The scheduled job also checks out `main` and `stage`, but the token's subject is the workflow's ref (`dev`).
- Permissions: `arn:aws:iam::aws:policy/ReadOnlyAccess`, and nothing else. `-lock=false` on every plan means no lock-file writes.
- Reads the state files, which hold secrets in plain text. That is the same exposure as the repository secrets themselves, to the same set of people.

### 6.2 `bgm-looper-tf-apply-nonprod`

- Trust: `<prefix>:ref:refs/heads/dev`, `<prefix>:ref:refs/heads/stage`.
- Permissions: `ReadOnlyAccess`, plus an inline policy allowing writes only on:
  - State: `s3:PutObject`, `s3:DeleteObject` on `bgm-looper-tf-state-<acct>/envs/dev/*` and `/envs/stage/*` (state and `.tflock`).
  - S3: `s3:*` on `portfolio-data-dev-<acct>`, `portfolio-data-stage-<acct>` and their `/*`, minus `s3:DeleteBucket`.
  - Lambda: `lambda:*` on `bgm-looper-processor-dev`, `-stage`, minus `lambda:DeleteFunction`.
  - CloudWatch: `cloudwatch:PutMetricAlarm`, `DeleteAlarms`, `TagResource` on the two alarm ARNs.
  - IAM: create, update, delete, tag, attach/detach and put/delete inline policies on roles `bgm-looper-lambda-exec-dev`, `-stage`; `iam:PassRole` on those two roles to `lambda.amazonaws.com`; `iam:PutRolePolicy`, `iam:DeleteRolePolicy` on role `bgm-looper-vercel-preview` (§9: cannot be limited to a policy name).
- Deliberately excluded: anything on `bgm-looper-vercel`, the main bucket, the main function, `shared/*` and `envs/main/*` state. The `DeleteBucket`/`DeleteFunction` exclusions mean a nonprod destroy that removes the bucket or function fails even with `apply-destroys`; that needs a local apply.

### 6.3 `bgm-looper-tf-apply-prod`

- Trust: `<prefix>:ref:refs/heads/main` (covers push and `workflow_dispatch` on `main`).
- Permissions: `ReadOnlyAccess`, plus an inline policy allowing all actions on the services this project's stacks manage: `s3`, `lambda`, `cloudwatch`, `sns`, `budgets`, `ecr`, `cognito-idp`, `ses`, `acm`, `logs`; and on `iam` only for resources named `bgm-looper-*` (roles, role policies) plus the two OIDC providers. State writes on `shared/*` and `envs/main/*`.
- It can modify its own role. That is inherent to letting CI manage the roles; §8 is the way back if it breaks itself.

## 7. Docs and process changes

- `CLAUDE.md` Merging: the infra rule becomes "read the plan the `terraform` workflow posted on the PR; it must show `No changes` or exactly the intended diff, and no `⚠ destroys` line you did not intend". The `Commands` Terraform line keeps the local commands as the break-glass path.
- `.claude/skills/merging-a-pr/SKILL.md`: same change; the `terraform plan` qualifier now points at the PR comment, and the `terraform` job is one of the checks that must be green.
- `.claude/rules/infra.md`: the three roles and their scope, the fork-PR setting, the destroy guard and how to use `workflow_dispatch`, the nonprod gap (§9), bootstrap and break-glass.
- `docs/runbooks/infra-apply-teardown.md`: Apply section describes the CI path first; kill-switch teardown stays local (CI never destroys).
- `CHANGELOG.md`: `[Unreleased]` entry.

## 8. Rollout

1. **PR 1, roles and lint config, applied locally.** `infra/shared/ci.tf` (three roles), `infra/.tflint.hcl`, and fixes for anything `tflint` reports today. Local apply of `shared` (expected: only the three roles and their policies added). Owner adds the four secrets and three variables.
2. **PR 2, the workflow.** `.github/workflows/terraform.yml` and the doc changes. Its own PR run is the first test: it must post plans showing `No changes` for `shared` and `envs/dev`. Merging into `dev` triggers the first CI apply of `envs/dev`, which must report no changes.
3. **Prove the apply path on `dev`:** a no-op-to-live change, such as a tag or a description on the dev alarm, PR'd into `dev`, merged, applied by CI.
4. **Prove the guard:** on a throwaway branch PR'd into `dev`, a change that replaces the dev alarm (rename it). The PR comment shows the `⚠` line; after merge, the apply job stops; `workflow_dispatch stack=envs/dev confirm=apply-destroys` applies it; a revert PR restores the name the same way.
5. **Promote** to `stage` and `main`. The promotion PRs post plans; the `main` push applies `shared` and `envs/main` with no changes.
6. **Drift:** run `workflow_dispatch stack=drift`; confirm no issue opens. Then make a harmless console change to the dev alarm's description, run it again, confirm the `drift` issue opens; revert the change, run again, confirm it closes.

Break-glass: the owner's workstation keeps its `personal` credentials and `terraform.tfvars`; a local plan/apply works exactly as today and is how a broken role or workflow is fixed.

## 9. Known limits

- **No reviewer gate.** GitHub environments with required reviewers need Pro on a private repo. Merge plus the destroy guard is the gate.
- **Preview role inline policies.** `iam:PutRolePolicy` has no condition key for the policy name, so `tf-apply-nonprod` can write any inline policy on `bgm-looper-vercel-preview`. Code merged only to `dev` could grant preview deployments access to production's bucket. Closing it means moving the per-env Vercel policies to managed policies (ARN-scoped); not done here.
- **Vercel token.** One account-wide token; nonprod applies can edit production's Vercel settings and env vars.
- **State holds secrets.** Every role can read state; so can anyone who can read the repository secrets. Unchanged from today's exposure to the owner.
- **Drift blind spot.** SNS email subscription status (`.claude/rules/infra.md`).

## 10. Cost

About 15 billed minutes per infra change carried to production (three PR plans, three applies), plus about 12 a month for drift. At 5 infra changes a month, about 90 minutes: 4.5% of the free 2,000. No AWS cost: IAM roles and STS are free.

## 11. Testing

- PR 1: `fmt`, `validate`, `tflint` clean locally; local `shared` plan adds exactly the three roles and their policies; `aws iam get-role` for each.
- PR 2: the workflow's own PR run, then §8 steps 3-6.
- A negative test of the nonprod scope: from a `dev` push, a deliberate change to an `envs/main` resource is impossible by construction (the dev job never plans `envs/main`); instead, verify with the IAM policy simulator (`aws iam simulate-principal-policy`) that `tf-apply-nonprod` is denied `s3:PutBucketPolicy` on `portfolio-data-<acct>`, `lambda:UpdateFunctionConfiguration` on `bgm-looper-processor`, `iam:PutRolePolicy` on `bgm-looper-vercel`, and `s3:PutObject` on `shared/terraform.tfstate`.
