# Apply `prod/account` from `main` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `infra/prod/account` applies only on pushes to `main`, and dev and stage own every Terraform-managed Vercel env var their previews read.

**Architecture:** Two PRs into `dev`, in order. PR 1 narrows production's seven `["production", "preview"]` Vercel vars to `production` and gives `modules/nonprod-app` its own six, while `dev` still applies `prod/account` ahead of `dev/app`. PR 2 changes the routing table in `.github/scripts/tf-stacks.sh`, drops `dev` from `bgm-looper-tf-apply-prod`'s trust, and updates the docs.

**Tech Stack:** Terraform 1.15.1 (`hashicorp/aws ~> 6.62`, `vercel/vercel ~> 5.15`, `hashicorp/random ~> 3.0`), Bash, Node's built-in test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-16-prod-account-from-main-design.md`

## Global Constraints

- PR 1 merges and its `dev` apply succeeds before PR 2 merges. One PR, or PR 2 first, makes `dev/app`'s creates collide with `prod/account`'s `preview` vars.
- Each PR has its own issue and closes it with `Closes #N`. Merge per the `merging-a-pr` skill: `--squash --delete-branch` into `dev`.
- No promotion (`dev → stage`, `stage → main`) is part of this plan. Those need the owner's OK per PR.
- `OPENROUTER_API_KEY` keeps the current key in every environment (`TF_VAR_OPENROUTER_API_KEY`). No new keys.
- `APP_PASSWORD` is narrowed to `production` and not copied. `KEYSTATIC_*`, `BUTTONDOWN_API_KEY` and `ACCESS_FROM_EMAIL` are untouched.
- `CHANGELOG.md`: an entry under `## [Unreleased]` in each PR. Prose plain, per CLAUDE.md's Writing rule.
- Every manual `aws` call names `--profile` and `--region us-east-1`.

## Review Focus

1. **Lock files.** CI runs `terraform init -lockfile=readonly` on Linux. Adding `hashicorp/random` to `dev/app` and `stage/app` without a `linux_amd64` hash in their `.terraform.lock.hcl` fails every plan. Task 1 locks both platforms.
2. **Replace instead of update.** If the Vercel provider replaces a var when `target` changes, the `dev` push's `prod/account` apply stops at the destroy guard and `dev/app` never runs. Task 3 reads the PR plan for `⚠ destroys or replaces` and, if present, applies with `-f confirm=apply-destroys` from `dev`.
3. **Stage between PR 1 and the next promotion.** Stage's branch reads dev's bare `preview` values (dev's `COOKIE_SECRET`, same model and key) until `stage/app` applies. The promotion push starts stage's Vercel build and the `stage/app` apply together, so stage may keep dev's values until its next build after that. Expected; redeploy stage if it matters.
6. **Destroy guard at release time (after PR 2).** Deleting or renaming a `.cedar` file, or anything else that plans a delete in `prod/account`, now stops the `main` push's apply while Vercel ships the web code: #519's gap in reverse. An edited policy updates in place (#519's plan showed `updated in-place`), so only deletes and replaces hit this. Task 5 documents the procedure: a `⚠` on the `stage → main` plan means running `gh workflow run terraform.yml --ref main -f stack=prod/account -f confirm=apply-destroys` right after the merge.
4. **Sign-out on dev and stage.** The new `COOKIE_SECRET` takes effect on each preview's next build. An old cookie must fail signature checks and send the user to sign in, not error. Task 3 confirms on dev after a redeploy.
5. **Drift during the transition.** Between PR 2 on `dev` and on `main`, the drift job plans no `prod/account`. Expected; it resumes after promotion.

---

## PR 1 — per-environment Vercel vars

Issue #527. Branch `chore/per-env-vercel-vars` from `dev`.

### Task 1: `modules/nonprod-app` owns its preview vars

**Files:**
- Modify: `infra/modules/nonprod-app/main.tf` (after `cognito_user_pool_id`, line 136)
- Modify: `infra/modules/nonprod-app/variables.tf`, `infra/modules/nonprod-app/versions.tf` (add `random = { source = "hashicorp/random", version = "~> 3.0" }` to `required_providers`)
- Modify: `infra/dev/app/{main.tf,variables.tf,backend.tf,terraform.tfvars.example,.terraform.lock.hcl}`
- Modify: `infra/stage/app/` the same five files

**Interfaces:**
- Produces: module input `openrouter_api_key` (string, sensitive, required); stack variable `openrouter_api_key` in `dev/app` and `stage/app`, filled in CI by `TF_VAR_openrouter_api_key`, which `terraform.yml` already exports.

- [ ] **Step 1:** Add to `modules/nonprod-app/variables.tf`: `openrouter_api_key` (sensitive, no default), `openrouter_model` and `news_desk_model` (default `"anthropic/claude-haiku-4.5"`, the same as `infra/prod/account/variables.tf`).
- [ ] **Step 2:** In `modules/nonprod-app/main.tf`, add `random_password.cookie_secret` (`length = 32`, `special = false`, as in `infra/prod/account/vercel-project.tf:3`) and six `vercel_project_environment_variable` resources in the existing pattern (`project_id = data.vercel_project.looper.id`, `target = ["preview"]`, `git_branch = var.vercel_git_branch`):

  | resource | key | value | sensitive |
  |---|---|---|---|
  | `cookie_secret` | `COOKIE_SECRET` | `random_password.cookie_secret.result` | true |
  | `aws_region` | `APP_AWS_REGION` | `"us-east-1"` | false |
  | `openrouter_api_key` | `OPENROUTER_API_KEY` | `var.openrouter_api_key` | true |
  | `openrouter_model` | `OPENROUTER_MODEL` | `var.openrouter_model` | false |
  | `openrouter_base_url` | `OPENROUTER_BASE_URL` | `"https://openrouter.ai/api/v1"` | false |
  | `news_desk_model` | `NEWS_DESK_MODEL` | `var.news_desk_model` | false |

  Update the file's header comment: the module now sets every preview var its environment reads.
- [ ] **Step 3:** In both `infra/<env>/app`: `variables.tf` gains `openrouter_api_key` (sensitive); `main.tf` passes `openrouter_api_key = var.openrouter_api_key`; `backend.tf`'s `required_providers` gains `random = { source = "hashicorp/random", version = "~> 3.0" }`; `terraform.tfvars.example` gains `openrouter_api_key = "..."` and its comment no longer says the stack needs only the Vercel token.
- [ ] **Step 4:** Lock the new provider for CI and Windows, from each of `infra/dev/app` and `infra/stage/app`:

  Run: `terraform init -backend=false -upgrade=false && terraform providers lock -platform=linux_amd64 -platform=windows_amd64`
  Expected: `.terraform.lock.hcl` gains `registry.terraform.io/hashicorp/random` at `3.9.1` (the version `prod/account` pins); the `aws` and `vercel` entries are unchanged in `git diff`.
- [ ] **Step 5:** Run from the repo root: `terraform fmt -check -recursive infra/`, then in each of `infra/dev/app` and `infra/stage/app` `terraform validate`, then `tflint --chdir=infra --recursive --config="$PWD/infra/.tflint.hcl"`.
  Expected: no output from fmt, `Success!` from validate, no tflint findings.
- [ ] **Step 6:** Commit: `chore(infra): give dev and stage their own preview Vercel vars`.

### Task 2: production's vars become production-only

**Files:**
- Modify: `infra/prod/account/vercel-project.tf:1,124-209`
- Modify: `.claude/rules/infra.md`, `CLAUDE.md` (Commands → Terraform: the required variables of each nonprod `app` stack), `README.md` (~line 167-170, each stack's inputs), `ARCHITECTURE.md` (~line 86, what the Vercel project shares), `CHANGELOG.md`

- [ ] **Step 1:** In `vercel-project.tf`, delete `local.env_targets` and set `target = ["production"]` on `app_password`, `cookie_secret`, `aws_region`, `openrouter_api_key`, `openrouter_model`, `openrouter_base_url` and `news_desk_model`. The line-1 header becomes "the Vercel project and production's config and secrets"; add one comment above the vars: dev's and stage's copies live in `infra/modules/nonprod-app`.
- [ ] **Step 2:** `infra.md`: in the per-account Vercel role bullet, add that every Terraform-managed Vercel var is per environment (production's in `prod/*`, previews' in `modules/nonprod-app`), and that the hand-set `KEYSTATIC_*` and `BUTTONDOWN_API_KEY` still cover `preview`. CLAUDE.md: each nonprod `app` stack needs `vercel_api_token` and `openrouter_api_key`.
- [ ] **Step 3:** `CHANGELOG.md` under `## [Unreleased]` → `### Changed`: dev and stage previews get their own `COOKIE_SECRET`, region and OpenRouter settings instead of production's; signed-in users on dev and stage are signed out once.
- [ ] **Step 4:** Run `terraform fmt -check -recursive infra/` and `terraform validate` in `infra/prod/account` (after `terraform init -backend=false`). Expected: clean, `Success!`.
- [ ] **Step 5:** Commit: `chore(infra): scope production's shared Vercel vars to production`.

### Task 3: PR 1 lands on `dev`

- [ ] **Step 1:** Push, open the PR into `dev` with `Closes #527`.
- [ ] **Step 2:** Read the Terraform plan comment. Expected:
  - `prod/account`: seven `vercel_project_environment_variable` updates (`target`), nothing else.
  - `dev/account`: `No changes`.
  - `dev/app`: `random_password.cookie_secret` and six vars to add.
  
  Anything else, or a `⚠` line, stops the task: report it to the owner.
- [ ] **Step 3:** Merge per the `merging-a-pr` skill.
- [ ] **Step 4:** Watch the `dev` push's `Terraform` run: `gh run watch <id>`. Expected: `prod/account`, `dev/account`, `dev/app` all apply. If the destroy guard stopped `prod/account`, read the listed addresses, then run `gh workflow run terraform.yml --ref dev -f stack=prod/account -f confirm=apply-destroys`, and after it `gh workflow run terraform.yml --ref dev -f stack=dev/app`.
- [ ] **Step 5:** Verify with the Vercel MCP `filter_project_envs` on project `bgm-looper`: each of the six keys has a `production` entry and a bare `preview` entry; `APP_PASSWORD` has only `production`.
- [ ] **Step 6:** Redeploy dev's latest deployment with the ignore step unticked (Vercel MCP or dashboard), open `https://dev.ashutosh-pandey.com/tools`, confirm a sign-in prompt (old cookie rejected) and that sign-in then works. Stage gets its copies on the next `dev → stage` promotion, which needs the owner's OK.

---

## PR 2 — apply `prod/account` from `main`

Issue #528. Branch `chore/prod-account-from-main` from `dev` after Task 3.

### Task 4: routing table

**Files:**
- Modify: `.github/scripts/tf-stacks.sh`
- Test: `.github/scripts/tf-stacks.test.mjs`

**Interfaces:**
- Produces: `resolve` output `stacks=dev/account dev/app` for `dev`, `stacks=prod/account prod/app` for `main`; `plan` output `prod/account dev/account dev/app` for `dev` (unchanged), `prod/account prod/app` for `main`; `drift` output `main:prod/account main:prod/app dev:dev/account dev:dev/app stage:stage/account stage:stage/app`.

- [ ] **Step 1: Write the failing tests.** In `tf-stacks.test.mjs`:
  - push test (renamed "dev applies dev/account then dev/app; stage …; main prod/account then prod/app"): `resolve("push","dev").out === "stacks=dev/account dev/app"`, `resolve("push","main").out === "stacks=prod/account prod/app"`.
  - dispatch test: `resolve("workflow_dispatch","main","prod/account").out === "stacks=prod/account"` replaces the `dev` one; in the rejection list, `["main","prod/account"]` becomes `["dev","prod/account"]`.
  - plan test (renamed "plan: prod/account on PRs into dev and main"): `BASE: "main"` → `"prod/account prod/app"`; `dev` and `stage` unchanged.
  - drift test: the string from Interfaces.
- [ ] **Step 2:** Run `node --test .github/scripts/tf-stacks.test.mjs`. Expected: the push, dispatch, plan and drift tests FAIL.
- [ ] **Step 3:** Edit `branch_stacks`, the `plan` case and the `drift` echo to the Interfaces values. Rewrite the header comment: `prod/account` is applied from `main` only (#524), still from one branch because its state is single; a PR into `dev` plans it as an early look at what `main` will apply. Update the `plan` case's comment the same way.
- [ ] **Step 4:** Run `node --test .github/scripts/*.test.mjs`. Expected: all pass.
- [ ] **Step 5:** Commit: `chore(ci): apply prod/account from main`.

### Task 5: trust, workflow text and docs

**Files:**
- Modify: `infra/prod/account/terraform-ci-roles.tf:24-29,87-93`
- Modify: `.github/workflows/terraform.yml:1-6,115-117,140-141`
- Modify: `.claude/rules/infra.md` (CI plan bullet, `Production:` apply-role bullet, Destroy guard, Drift)
- Modify: `CLAUDE.md:13`, and every other CLAUDE.md line saying `prod/account` applies from `dev` (grep `from \`dev\``, `#345`)
- Modify: `docs/runbooks/infra-apply-teardown.md:40-42,73-77`, `docs/runbooks/account-suspension-recovery.md:19` (production's applying branches become `main`)
- Modify: `.claude/skills/merging-a-pr/` (the promotion section: a `⚠` on a `stage → main` plan's `prod/account` means dispatching `apply-destroys` from `main` right after the merge)
- Modify: `CHANGELOG.md`

- [ ] **Step 1:** `tf_trust["prod"]` becomes `["${local.github_sub_prefix}:ref:refs/heads/main"]`; its comment and the role's comment say `main` applies both production stacks (#524) and that a `prod/account` change reaches production when it ships. `tf_trust["plan"]` is unchanged (PRs and `dev`, where drift runs).
- [ ] **Step 2:** `terraform.yml`: header line 3-4 says `main` applies `prod/account` then `prod/app`; the apply step's comment says the same. Replace the PR-comment title condition with: when `BASE` is `dev`, append "`prod/account` applies from `main`; its plan here includes everything on `dev` not yet on `main`". Drop the old non-`dev` note.
- [ ] **Step 3:** Docs: replace each "applied from `dev`" statement with "applied from `main`", and in `infra.md`'s Destroy guard the owner list becomes `dev/*` on `dev`, `stage/*` on `stage`, `prod/account` and `prod/app` on `main`. Drift: "`prod/account` from `main`". The Destroy guard bullet and `infra-apply-teardown.md`'s Apply section add Review Focus 6's procedure. Add one sentence to CLAUDE.md line 13: a production-only change (OIDC, budgets, DNS) ships through `dev → stage → main`, and the `stage → main` PR's plan is the one that shows what will apply.
- [ ] **Step 4:** `CHANGELOG.md` → `### Changed`: production's account stack applies when a release reaches `main`, not on merge to `dev`.
- [ ] **Step 5:** Run `terraform fmt -check -recursive infra/`, `terraform validate` in `infra/prod/account`, and `rg -n 'prod/account' CLAUDE.md .claude docs/runbooks .github` and read every hit for a stale "from `dev`". Expected: clean, `Success!`, no stale hit.
- [ ] **Step 6:** Commit: `chore(infra): trust main only for production's apply role`.

### Task 6: PR 2 lands on `dev`

- [ ] **Step 1:** Push, open the PR into `dev` with `Closes #528`.
- [ ] **Step 2:** Read the plan comment. Expected: `prod/account` shows one update, `aws_iam_role.tf_apply_prod`'s `assume_role_policy` losing the `dev` subject (plus anything else already on `dev` but not on `main`); `dev/account` and `dev/app` `No changes`. The title carries the new `dev` note.
- [ ] **Step 3:** Merge per `merging-a-pr`.
- [ ] **Step 4:** Watch the `dev` push's `Terraform` run. Expected: `Apply dev/account dev/app`, no `prod/account`.
- [ ] **Step 5:** Tell the owner: `prod/account`'s trust change and any pending `prod/account` change apply on the next `main` push; drift skips `prod/account` until then.

---

## Follow-ups (not in this plan)

- #529: delete `APP_PASSWORD`.
- #530: `ACCESS_FROM_EMAIL` on dev and stage.
