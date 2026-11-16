# Apply `prod/account` from `main` — design

Issue #524. Short design (small change).

## Why

`terraform.yml` applies `infra/prod/account` on every push to `dev` (#345). That stack holds production's Cognito and Verified Permissions, so a Cedar change reaches production when it merges to `dev`, days before the web code that goes with it. #519 did exactly this: production friends could not open any tool page until #521 shipped, and a GitHub outage stretched the gap.

The owner wants a high degree of isolation between environments: a change reaches production only when `main` ships.

## Findings

1. Nothing on `dev` or `stage` needs `prod/account` applied first any more. Since #397 every `data` lookup in the dev and stage stacks (ECR, SNS, IAM roles, `terraform_remote_state`) resolves in that environment's own account. The one lookup outside it is `data "vercel_project" "looper"` in `modules/app` and `modules/nonprod-app`, which needs the project to exist, not to be up to date. #345's reason is gone.
2. What still couples them is Vercel. `prod/account` sets seven env vars for `["production", "preview"]` (`local.env_targets`): `APP_PASSWORD`, `COOKIE_SECRET`, `APP_AWS_REGION`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `NEWS_DESK_MODEL`. Applied from `main`, a change to any of them would reach dev's previews last.
3. `main` and `dev` have identical `infra/prod/account` and `infra/modules/auth` today, so the first apply from `main` changes nothing.
4. Every push to `main` runs `deploy.yml`'s `release` job. A production-only change (OIDC, budgets, DNS) therefore goes `dev → stage → main` and cuts a patch release. Nothing shorter works: anything applied to production that is not on `main` is reverted by the next `main` apply.
5. A `prod/account` plan that deletes or replaces something (a removed `.cedar` file, say) stops at the destroy guard on the `main` push while Vercel ships the web code. Edited policies update in place (#519's plan), so this hits only deletes and replaces. The fix is an `apply-destroys` dispatch from `main` right after the merge, documented in PR 2.
6. Production's OpenRouter key will also sit in dev's and stage's Terraform state, in their own accounts' state buckets.
7. Within one `main` push, Terraform and the Vercel build still run side by side, so a Cedar change and its web code can be minutes apart. That is the remaining gap; it was days.

## Goals

- `prod/account` is applied only from `main`, ahead of `prod/app` in the same run.
- Every Terraform-managed Vercel env var has its own value per environment. Dev and stage get their own copies of the six vars that are used.
- `bgm-looper-tf-apply-prod` is no longer trusted from `dev`.

## Non-goals

- The single Vercel project, its project-level settings (`ignore_command`, firewall, domains, `vercel_authentication`) and its account-wide API token stay shared. Splitting into three projects costs three Git integrations, moved domains and triple builds for little isolation.
- A separate OpenRouter key per environment. The preview copy of `OPENROUTER_API_KEY` moves to the app stacks but keeps the current key; splitting later is a per-stack secret change. The owner may move to Bedrock instead.
- `KEYSTATIC_*` and `BUTTONDOWN_API_KEY` stay hand-set in the dashboard, untouched.
- Deleting `APP_PASSWORD` (nothing reads it) and giving dev and stage `ACCESS_FROM_EMAIL` (their previews send no access emails today) are separate issues.

## Approaches

- **Two PRs, vars first, then routing (chosen).** PR 1 moves the preview vars while `dev` still applies `prod/account` ahead of `dev/app`, so the old `preview` copies are gone before the new ones are created. PR 2 switches the routing.
- **One PR.** The `dev` push would already run the new routing, so `dev/app` would try to create `preview` vars that `prod/account`'s copies still cover, and fail until `main` ships. Rejected.
- **Routing first, then vars.** Same collision, lasting a full release cycle. Rejected.
- Option (b) of the issue, moving only `modules/auth` into `prod/app`, needs a state move and still leaves the rest of `prod/account` (roles, Vercel project, shared vars) applied from `dev`. Rejected as less isolation for more work. Option (c), documenting the rule, leaves the #519 risk in place.

## Design

### PR 1 — per-environment Vercel vars

- `infra/prod/account/vercel-project.tf`: `local.env_targets` becomes `["production"]` (or the seven resources set `target = ["production"]` and the local goes). `APP_PASSWORD` is narrowed with the rest and not copied anywhere.
- `infra/modules/nonprod-app/main.tf`: six new `vercel_project_environment_variable` resources with `target = ["preview"]` and `git_branch = var.vercel_git_branch`, matching the existing ones: `COOKIE_SECRET` (from a new `random_password` in the module, so each environment has its own), `APP_AWS_REGION`, `OPENROUTER_API_KEY` (sensitive, from a new `openrouter_api_key` variable), `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `NEWS_DESK_MODEL`. Values other than the key and the cookie secret are the same as production's today.
- `infra/dev/app` and `infra/stage/app`: pass `openrouter_api_key` through; `variables.tf` and `terraform.tfvars.example` gain it. CI already exports `TF_VAR_openrouter_api_key` to every stack.
- Rollout: the `dev` push applies `prod/account` (narrowing), then `dev/app` (dev's copies). The `dev → stage` promotion applies `stage/app` (stage's `git_branch = "stage"` copies). Until then stage's branch reads dev's bare `preview` values. Read the PR's plan: if the provider replaces rather than updates a narrowed var, the destroy guard stops the apply and it is run with `apply-destroys` from `dev`.
- Env vars reach a deployment only on a new build, and an infra-only push builds nothing. Dev and stage pick up their new values, including the new `COOKIE_SECRET` (one sign-out), on their next web push or a manual redeploy.

### PR 2 — apply `prod/account` from `main`

- `.github/scripts/tf-stacks.sh`: `branch_stacks dev` → `dev/account dev/app`; `main` → `prod/account prod/app`. `plan`: PRs into `dev` plan `prod/account dev/account dev/app` (an early look, labelled as applying from `main`); PRs into `main` plan `prod/account prod/app`; `stage` unchanged. `drift` pair becomes `main:prod/account`. Header comment updated. `tf-stacks.test.mjs` follows.
- `.github/workflows/terraform.yml`: header comment, the apply step's comment, and the PR-comment title, which says `prod/account` applies from `main` and that a plan of it on a PR into `dev` is a preview.
- `infra/prod/account/terraform-ci-roles.tf`: `tf_trust["prod"]` trusts only `main`; comments on the trust and the role updated. This applies on the first `main` push after PR 2 is promoted, under the role as it is then (trusted from `main`), so CI does not lock itself out.
- Docs: `.claude/rules/infra.md` (CI plan bullet, apply role, destroy guard, drift), CLAUDE.md (`infra/prod/account` structure line, Branching & releases, the PR-plan bullet under Merging a PR), and the runbooks that name where `prod/account` applies: `infra-apply-teardown.md`, `link-owner-google.md`, `account-suspension-recovery.md`, `incident-tool-down.md`. `CHANGELOG.md` entries in each PR.
- Transition: between PR 2 reaching `dev` and reaching `main`, nobody applies `prod/account`, and the drift job skips it (`dev`'s new table says `main:prod/account`, `main`'s old one says `dev:prod/account`, and each branch keeps only its own pairs). Any `prod/account` change merged in that window applies when it reaches `main`.

## Left to the builder

Exact comment wording; whether to keep `local.env_targets` or inline the target; test cases in `tf-stacks.test.mjs` beyond the changed routes.
