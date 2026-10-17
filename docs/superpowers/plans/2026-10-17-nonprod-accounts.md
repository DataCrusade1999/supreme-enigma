# Dev and stage in their own accounts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move bgm-looper's dev and stage environments, rebuilt empty, out of 223376380711 into accounts 624586968135 (dev) and 792682047320 (stage). Each gets its own sign-in, authorization, resume, image repo, state and CI roles. Production stays untouched.

**Architecture:** Each nonprod account gets two stacks:
- `infra/nonprod/<env>/account`: OIDC, CI roles, ECR, SNS, SES, and Cognito plus Verified Permissions through a new `modules/auth`, which prod's `shared` also adopts via `moved` blocks.
- `infra/nonprod/<env>/env`: the existing `modules/environment`, plus the env's resume grant and preview Vercel vars. It reads the account stack's outputs from the same account's state.

CI picks a role per stack from one routing table in `.github/scripts/tf-stacks.sh`. Each environment is cut over in two PRs, a base PR and a cutover PR, and the legacy prod-account stack is destroyed in between. Prod cleanup comes last.

**Tech Stack:** Terraform 1.15.1, `hashicorp/aws ~> 6.62`, `vercel/vercel ~> 5.15`, `hashicorp/random ~> 3.0`; GitHub Actions; Node 22 `node:test`; Vitest (web); aws-org repo `terraform test` with `mock_provider`.

**Spec:** `docs/superpowers/specs/2026-10-17-nonprod-accounts-design.md`

## Global Constraints

- **Accounts and region:** prod `223376380711`, dev `624586968135`, stage `792682047320`. Region `us-east-1` only.
- **Profiles:**
  - `personal` is prod. `personal-dev` and `personal-stage` are the nonprod accounts. `personal-mgmt` is for the aws-org repo only.
  - The looper repo's `.claude/settings.local.json` sets `AWS_PROFILE=personal`, so every nonprod command names its profile explicitly. Every new stack's provider sets `allowed_account_ids` to its one account.
- **Nonprod names:**
  - state bucket `bgm-looper-tf-state-<account id>`, keys `account/terraform.tfstate` and `env/terraform.tfstate`
  - roles `bgm-looper-tf-plan`, `bgm-looper-tf-apply`, `bgm-looper-ci-deploy`, `bgm-looper-vercel-preview`
  - ECR `bgm-looper-lambda`
  - SNS `bgm-looper-budget-alerts`
  - data bucket `portfolio-data-<env>-<account id>`, function `bgm-looper-processor-<env>` (both from `modules/environment`, unchanged)
- **Domains:**
  - sign-in `auth.dev.ashutosh-pandey.com`, `auth.stage.ashutosh-pandey.com`
  - SES identities `dev.ashutosh-pandey.com`, `stage.ashutosh-pandey.com`, from `Sign-in <no-reply@<env>.ashutosh-pandey.com>`
  - Vercel slug `ashutosh-pandeys-projects-77cb3a00`, team ID `team_bSWug4zpM7jfChbYKg7G4PMI`
  - GitHub sub prefix `repo:DataCrusade1999@57610394/supreme-enigma@1313947304`
- **Forbidden in the nonprod accounts:** customer-managed KMS keys, Secrets Manager, CloudTrail trails, AWS Config.
- **Forbidden across accounts:** any trust or resource policy between nonprod and prod. Nonprod stacks never read prod's state.
- **Prod plans:** no destroy or replace of a prod resource except the removals Task 14 lists. Auth's move into a module is `moved` only (0 add, 0 change, 0 destroy).
- **Plan JSON:** never print or upload it (it holds secrets). Only `terraform show -no-color` text goes into PR comments.
- **Action pins:** as in `.github/workflows/terraform.yml` today.
- **Commits:** Conventional Commits, ending `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.
- **PRs:** into `dev`, using the `merging-a-pr` skill. Changes reach `stage` and `main` only by promotion PRs.
- **Local applies:** run from a saved plan whose counts were checked first.

## Review Focus

1. **A nonprod stack run with prod credentials.** `AWS_PROFILE=personal` leaks from the repo's settings. It must fail before any change, not create dev resources in prod. Pinned by `allowed_account_ids` and the wrong-profile plan check in Task 6.
2. **A preview publishing while its `RESUME_BUCKET_NAME` still points at `portfolio-data-223376380711`.** That would overwrite the live resume. Task 13 has a precondition step that reads both preview values, and the guard change merges only after Task 12 is on `stage`.
3. **A Vercel env var changed without a redeploy.** The running deployment keeps the old values, so a "done" check can pass against stale config. Every cutover redeploys the branch, then checks the values the deployment actually uses.
4. **A fresh Cognito pool with WebAuthn.** The `RelyingPartyId` failure in `.claude/rules/infra.md` comes back on every new pool. Pinned by `webauthn_enabled` in `modules/auth` (Task 4) and the two-pass first apply (Tasks 9, 11).
5. **Two stacks owning one Vercel key for the same target and branch.** The apply fails, or Vercel holds two values. Cutovers destroy the legacy stack before the new one applies, and `shared` narrows its targets in the same PR as the new env stack.

---

### Task 1: Local access and pre-checks (no repo change)

- [ ] **Step 1:** Add profiles `personal-dev` (624586968135) and `personal-stage` (792682047320) to `~/.aws/config`. Use `sso_session = personal-org`, `sso_role_name = AdministratorAccess`, `region = us-east-1`.
- [ ] **Step 2:** Run `aws sts get-caller-identity --profile personal-dev` and the same with `--profile personal-stage`. Expected: `Account` 624586968135 and 792682047320.
- [ ] **Step 3:** For each account, record:
  - `aws service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384`
  - `aws sesv2 get-account` (expect `ProductionAccessEnabled: false`)
  - `nslookup dev.ashutosh-pandey.com` and `nslookup stage.ashutosh-pandey.com`: each must resolve to an A record. Cognito requires the parent of a custom domain to resolve.

  If a parent doesn't resolve, stop and report.

### Task 2: State bucket per nonprod account

**Files:** none changed. `infra/bootstrap` is applied once per account, in its own local workspace.

- [ ] **Step 1:** `terraform -chdir=infra/bootstrap workspace new dev`, then `terraform -chdir=infra/bootstrap plan -var aws_profile=personal-dev -out=dev.tfplan`. Expected: 5 to add: bucket `bgm-looper-tf-state-624586968135`, its versioning, SSE and public access block, plus `aws_s3_account_public_access_block.account`. That last one is account-wide on purpose, the same as in prod.
- [ ] **Step 2:** `terraform -chdir=infra/bootstrap apply dev.tfplan`.
- [ ] **Step 3:** Repeat steps 1–2 with workspace `stage`, `personal-stage` and bucket `bgm-looper-tf-state-792682047320`.
- [ ] **Step 4:** `aws s3api get-bucket-versioning --bucket <bucket> --profile <profile>` for both. Expected: `Enabled`. Then `terraform -chdir=infra/bootstrap workspace select default`.

### Task 3: aws-org: archive rules for the nonprod OIDC roles

**Repo:** `E:\Personal\aws-org`, new branch `task-15-nonprod-oidc-archive-rules`, profile `personal-mgmt`.
**Files:**
- Modify: `security/access-analyzer.tf`
- Modify: `security/variables.tf`
- Modify: `security/terraform.tfvars.example`
- Modify: `security/tests/security.tftest.hcl`
- Modify: the gitignored `security/terraform.tfvars`

**Interfaces:** Produces the variables `dev_account_id` and `stage_account_id`, and the `looper_oidc_roles` keys `github`, `vercel`, `dev-github`, `dev-vercel`, `stage-github`, `stage-vercel`. Each entry carries `account`, `provider` and `roles`. The prod keys stay `github` and `vercel`, so their rule names don't change and no rule is replaced.

- [ ] **Step 1: Write the failing test.** In the test variables add `dev_account_id = "444444444444"` and `stage_account_id = "555555555555"`. Assert:
  - `aws_accessanalyzer_archive_rule.looper_oidc_roles["dev-github"]`'s resource filter contains `arn:aws:iam::444444444444:role/bgm-looper-tf-apply` and `arn:aws:iam::444444444444:role/bgm-looper-ci-deploy`, and its `principal.Federated` filter is exactly `["arn:aws:iam::444444444444:oidc-provider/token.actions.githubusercontent.com"]`.
  - `["stage-vercel"]`'s resource filter is exactly `["arn:aws:iam::555555555555:role/bgm-looper-vercel-preview"]`.
  - `aws_accessanalyzer_archive_rule.looper_oidc_roles["github"].rule_name == "bgm-looper-github-oidc-roles"`.
- [ ] **Step 2:** Run `terraform -chdir=security test`. Expected: FAIL (unknown variable / key).
- [ ] **Step 3: Implement.**
  - Add `account` to each `looper_oidc_roles` entry and use it in both filters in place of `var.prod_account_id`.
  - Add the four nonprod entries. The GitHub roles are `bgm-looper-tf-plan`, `bgm-looper-tf-apply` and `bgm-looper-ci-deploy`. The Vercel role is `bgm-looper-vercel-preview`.
  - Add both variables with the descriptions "Dev/Stage account ID (org output account_ids.dev/stage), home of bgm-looper's dev/stage OIDC roles." Set the real values 624586968135 and 792682047320 in `terraform.tfvars`.
- [ ] **Step 4:** Run `terraform -chdir=security test`. Expected: PASS. Then `terraform -chdir=security plan -out=t15.tfplan`. Expected: 4 to add, 0 to change, 0 to destroy.
- [ ] **Step 5:** Commit as `feat(security): archive rules for bgm-looper's dev and stage OIDC roles`. Open a PR with the plan output, merge, then `terraform -chdir=security apply t15.tfplan`.

### Task 4: `modules/auth`: one Cognito and Verified Permissions definition, prod moved into it

**Files:**
- Create: `infra/modules/auth/{main.tf,variables.tf,outputs.tf,versions.tf}`
- Move: `infra/shared/cedar/`, `infra/shared/branding.json`, `infra/shared/branding/` into `infra/modules/auth/`, with `git mv` (`branding/generate` comes too)
- Modify: `infra/shared/auth.tf`, `infra/shared/access.tf`, `infra/shared/outputs.tf`

**Interfaces:** Produces `module "auth"` with these inputs:
- `project_name` (string)
- `auth_domain` (string)
- `dns_domain` (string)
- `vercel_team_id` (string)
- `callback_urls` (list(string))
- `ses_identity` (string: the SES identity name the pool sends from)
- `ses_identity_arn` (string)
- `from_email_address` (string)
- `google_client_id` (string)
- `google_client_secret` (string, sensitive)
- `owner_email` (string)
- `account_id` (string)
- `region` (string)
- `webauthn_enabled` (bool, default `true`)

The module has **no data sources**. The SES identity policy (`auth.tf:84-85`) uses `var.account_id` and `var.region`. `shared`'s call has `depends_on = [vercel_dns_record.caa_amazon]`, and a module-level `depends_on` defers every data source inside the module to apply time. That would turn the 0/0/0 plan into an update. Nonprod calls need no `depends_on`: the apex CAA record already exists in prod.

Outputs: `user_pool_id`, `user_pool_arn`, `client_id`, `domain_url` (`https://<auth_domain>`), `policy_store_id`, `policy_store_arn`.

What moves into the module, and what stays in `shared`:
- **Moves:** every resource in today's `auth.tf` except `vercel_dns_record.caa_amazon` and the three `COGNITO_*` Vercel vars, plus from `access.tf` the policy store, schema, policies (`for_each`), identity source, `aws_cognito_user_group.owner`/`.friends` and `aws_cognito_user_in_group.owner`. Each gets its own `moved` block.
- **Stays in `shared`:** the CAA record (the module call `depends_on` it), the Vercel vars, `aws_iam_role_policy.vercel_access`, `vercel_preview_access`, and everything SES in `email.tf`.

- [ ] **Step 1: Baseline.** On the branch, before any change, `terraform -chdir=infra/shared plan` as `personal` must show `No changes`. Record the resource count from `terraform -chdir=infra/shared state list | wc -l`.
- [ ] **Step 2: Implement the module.**
  - Move the resource blocks verbatim, replacing literals with the inputs. The Vercel DNS record names are `trimsuffix(var.auth_domain, ".${var.dns_domain}")` and the ACM names relative to `var.dns_domain`.
  - Wrap `web_authn_configuration` in `dynamic` on `var.webauthn_enabled`, with a comment pointing to the `.claude/rules/infra.md` bullet.
  - Keep the file paths module-relative (`${path.module}/cedar/...`).
- [ ] **Step 3: Call it from `shared`.** Pass `auth_domain = "auth.${vercel_project_domain.custom.domain}"` and today's `local.login_callback_urls`. Add one `moved` block per moved resource address (`from = aws_cognito_user_pool.owner`, `to = module.auth.aws_cognito_user_pool.owner`, and so on, including the `for_each` resources and `random_password.owner_cognito`). Point the Vercel vars and `vercel_access` at the module outputs.
- [ ] **Step 4:** Add the module outputs to `infra/shared/outputs.tf` as `cognito_user_pool_id`, `cognito_client_id`, `cognito_domain_url`, `avp_policy_store_id`. Add `vercel_preview_role_arn` (`aws_iam_role.vercel_preview.arn`) and `resume_bucket_name` (`local.data_bucket_names["main"]`). Task 8 reads these.
- [ ] **Step 5:** Run `terraform fmt -check -recursive infra/`, `terraform -chdir=infra/shared validate`, and tflint as in `terraform.yml`. Expected: clean.
- [ ] **Step 6:** `terraform -chdir=infra/shared plan -out=t4.tfplan` as `personal`. Expected: `0 to add, 0 to change, 0 to destroy`, with only "has moved to" lines, as many as the moved addresses. Any other change means the module isn't identical to today's resources: fix it, don't apply.
- [ ] **Step 7:** Commit as `refactor(infra): move Cognito and Verified Permissions into modules/auth`. Merge the PR into `dev`. CI applies `shared` with the moves only.

### Task 5: CI routing table and per-stack credentials (no behaviour change)

**Files:**
- Modify: `.github/scripts/tf-stacks.sh`, `.github/scripts/tf-stacks.test.mjs`
- Create: `.github/scripts/tf-as.sh`
- Modify: `.github/workflows/terraform.yml` (plan, apply and drift jobs)
- Modify: `.github/workflows/deploy.yml:517-526`

**Interfaces:** Produces:
- `tf-stacks.sh resolve` (EVENT, BRANCH, INPUT) prints `stacks=<space-separated stacks in apply order>`.
- `tf-stacks.sh plan` (BASE) prints stacks.
- `tf-stacks.sh drift` prints `branch:stack` pairs.
- `tf-stacks.sh role <stack> <plan|apply>` prints a role ARN.
- `tf-as.sh <stack> <plan|apply> <command...>` runs the command with that role's credentials.

Later tasks edit only the branch table in `tf-stacks.sh` and the dispatch choices.

- [ ] **Step 1: Write the failing tests.** Replace the `resolve` assertions with the `stacks=` form and today's routing:
  - push `dev` → `stacks=shared envs/dev`; `stage` → `stacks=envs/stage`; `main` → `stacks=envs/main`
  - dispatch `dev`/`shared` → `stacks=shared`; `dev`/`envs/dev` → `stacks=envs/dev`
  - the existing error cases and messages unchanged

  Add:
  - `role shared apply` → `arn:aws:iam::223376380711:role/bgm-looper-tf-apply-prod`
  - `role envs/main apply` → the same
  - `role envs/dev apply` and `role envs/stage apply` → `arn:aws:iam::223376380711:role/bgm-looper-tf-apply-nonprod`
  - `role <any prod-account stack> plan` → `arn:aws:iam::223376380711:role/bgm-looper-tf-plan`
  - `role nonprod/dev/env apply` → `arn:aws:iam::624586968135:role/bgm-looper-tf-apply`
  - `role nonprod/stage/account plan` → `arn:aws:iam::792682047320:role/bgm-looper-tf-plan`
  - `role bogus apply` exits 1, matching `/::error::no role for bogus/`
  - `drift` → `dev:shared stage:envs/stage dev:envs/dev main:envs/main`
- [ ] **Step 2:** Run `node --test .github/scripts/tf-stacks.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `tf-stacks.sh`.** Keep one `case` per branch listing its stacks, plus a `role` function that maps a stack prefix to its account (`nonprod/dev/*` → dev, `nonprod/stage/*` → stage, else prod) and the mode to a role name.
- [ ] **Step 4: Implement `tf-as.sh`.**
  - Fetch a GitHub OIDC token (`$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com`).
  - Call `aws sts assume-role-with-web-identity --duration-seconds 3600` for `$(tf-stacks.sh role "$1" "$2")`.
  - `::add-mask::` the secret key and session token, export the three `AWS_*` variables, unset `AWS_PROFILE`, then `exec` the rest of the arguments.

  One session per stack, because GitHub's token is short-lived and each terraform process otherwise assumes again.
- [ ] **Step 5: Change `terraform.yml`.**
  - Delete the `configure-aws-credentials` steps.
  - The plan and drift loops wrap each `terraform` call as `tf-as.sh "$stack" plan terraform ...`. Drift takes its pairs from `tf-stacks.sh drift`.
  - Apply loops `for s in $STACKS; do bash .github/scripts/tf-as.sh "$s" apply bash .github/scripts/tf-apply.sh "$s"; done`.
  - Delete the `ROLE_PREFIX` env.
  - `resolve`'s output changes from `shared=`/`env=`/`role=` to `stacks=`. Its consumers (`steps.stacks.outputs.shared` and `.env`, `terraform.yml:161,167`) change in this same PR.
  - Today the drift pairs are inline at `terraform.yml:225`. Move them into `tf-stacks.sh drift`.
- [ ] **Step 6:** In `deploy.yml`, give each `case` arm a `role_arn` output. All three are `arn:aws:iam::223376380711:role/bgm-looper-ci-deploy` for now. `role-to-assume: ${{ steps.env.outputs.role_arn }}`.
- [ ] **Step 7:** Run `node --test .github/scripts/tf-stacks.test.mjs` (expect PASS) and `actionlint` if installed. Open the PR: its own `plan` job must post a plan of `shared envs/dev` with `No changes`. That proves `tf-as.sh`.
- [ ] **Step 8:** Commit as `ci(terraform): route roles per stack from tf-stacks.sh`. Merge. The push to `dev` must apply both stacks with `No changes`.

### Task 6: `modules/nonprod-account` and the two account stacks (code only)

**Files:**
- Create: `infra/modules/nonprod-account/{main.tf,iam.tf,email.tf,variables.tf,outputs.tf,versions.tf}`
- Create: `infra/nonprod/{dev,stage}/account/{backend.tf,providers.tf,variables.tf,main.tf,outputs.tf,terraform.tfvars.example}`

**Interfaces:**
- **Consumes:** `module "auth"` (Task 4).
- **Module inputs:**
  - `env` (`dev` | `stage`, validated)
  - `project_name`
  - `github_sub_prefix`
  - `vercel_team_slug`, `vercel_team_id`
  - `dns_domain`
  - `alert_email`
  - `google_client_id`, `google_client_secret`
  - `webauthn_enabled` (bool, default `true`)
- **Outputs:** `cognito_user_pool_id`, `cognito_client_id`, `cognito_domain_url`, `avp_policy_store_id`, `vercel_role_arn`.
- **Root outputs:** the same names. Task 7 reads them through `terraform_remote_state`.

What the module creates, all in its own account:
- OIDC providers for `token.actions.githubusercontent.com` (`client_id_list = ["sts.amazonaws.com"]`) and `oidc.vercel.com/<slug>` (`client_id_list = ["https://vercel.com/<slug>"]`), copied from `shared.tf:126-205`.
- `bgm-looper-tf-plan`:
  - trust `StringEquals` sub `[<prefix>:pull_request, <prefix>:ref:refs/heads/dev]`
  - `ReadOnlyAccess`, plus the `VerifiedPermissionsReads` inline policy from `ci.tf`
- `bgm-looper-tf-apply`: trust sub `[<prefix>:ref:refs/heads/<env>]`, `AdministratorAccess`.
- `bgm-looper-ci-deploy`:
  - trust sub `[<prefix>:ref:refs/heads/<env>]`
  - inline: `ecr:GetAuthorizationToken` on `*`; the seven ECR push actions from `shared.tf:175-183` on its repo; `lambda:UpdateFunctionCode` and `lambda:GetFunction` on `arn:aws:lambda:us-east-1:<account>:function:bgm-looper-processor-<env>`
- `bgm-looper-vercel-preview`:
  - trust aud `https://vercel.com/<slug>`, sub `owner:<slug>:project:bgm-looper:environment:preview`
  - inline `AuthorizeRequests` (`verifiedpermissions:IsAuthorizedWithToken` on the module's store)
- ECR `bgm-looper-lambda`: `IMMUTABLE`, scan on push, `force_delete = true`. Lifecycle: untagged after 1 day; keep 1 image tagged with prefix `<env>`.
- SNS `bgm-looper-budget-alerts`, an email subscription to `alert_email`, and the topic policy's `CloudWatchAlarmsPublish` statement only, conditioned on `aws:SourceAccount`.
- SES:
  - `aws_sesv2_email_identity` `<env>.<dns_domain>` with `RSA_2048_BIT` DKIM
  - three `vercel_dns_record` CNAMEs `<token>._domainkey.<env>` → `<token>.dkim.amazonses.com`
  - `aws_sesv2_email_identity` for `alert_email` (the sandbox recipient)
  - no MAIL FROM, no DMARC record (the apex DMARC covers subdomains)
- `module "auth"` with:
  - `auth_domain = "auth.<env>.<dns_domain>"`
  - `callback_urls`: `https://<env>.<dns_domain>/api/auth/callback`, `https://bgm-looper-git-<env>-<slug>.vercel.app/api/auth/callback`, and for `dev` only `http://localhost:3000/api/auth/callback`
  - `ses_identity`/`ses_identity_arn` = the domain identity
  - `from_email_address = "Sign-in <no-reply@<env>.<dns_domain>>"`

Root stacks:
- `backend "s3"`: bucket `bgm-looper-tf-state-<account>`, key `account/terraform.tfstate`, `use_lockfile = true`.
- Provider `aws`:
  - `allowed_account_ids = ["624586968135"]` (or `["792682047320"]` for stage)
  - `profile = var.aws_profile` (default `null`)
  - `default_tags { app = "bgm-looper" }`
- Provider `vercel`.
- Variables: `aws_profile`, `vercel_api_token`, `alert_email`, `google_client_id`, `google_client_secret`, `webauthn_enabled`.

- [ ] **Step 1: Write the failing check.** Run `terraform -chdir=infra/nonprod/dev/account init -backend=false` then `validate`. Expected: FAIL, the directory doesn't exist yet.
- [ ] **Step 2: Implement** the module and both roots as above.
- [ ] **Step 3:** Run fmt, validate (both roots, `-backend=false`) and tflint. Expected: clean.
- [ ] **Step 4: Wrong-account guard.** With `$env:AWS_PROFILE='personal'`, run `terraform -chdir=infra/nonprod/dev/account init` then `plan`. Expected: the plan errors with `AWS account ID not allowed: 223376380711` and changes nothing. With `-var aws_profile=personal-dev`, the plan shows only creates, no updates or destroys.
- [ ] **Step 5:** Run `grep -rn 223376380711 infra/nonprod infra/modules/nonprod-account`. Expected: no output.
- [ ] **Step 6:** Commit as `feat(infra): nonprod account stacks for dev and stage`. Open a PR and merge. Nothing applies yet, because routing doesn't list these stacks.

### Task 7: `modules/nonprod-env`, the two env stacks, and per-env CORS

**Files:**
- Create: `infra/modules/nonprod-env/{main.tf,variables.tf,outputs.tf,versions.tf}`
- Create: `infra/nonprod/{dev,stage}/env/{backend.tf,providers.tf,variables.tf,main.tf,outputs.tf,terraform.tfvars.example}`
- Modify: `infra/modules/environment/main.tf:53-61` (`app_origins` per env)

**Interfaces:**
- **Consumes:** the Task 6 root outputs, through `data "terraform_remote_state" "account"` (bucket `bgm-looper-tf-state-<account>`, key `account/terraform.tfstate`).
- **Module inputs:**
  - `env`
  - `project_name`
  - `bootstrap_image_tag`
  - `vercel_git_branch` (`null` for dev, `"stage"` for stage)
  - `vercel_role_arn`
  - `cognito_user_pool_id`, `cognito_client_id`, `cognito_domain_url`
  - `avp_policy_store_id`
- **Outputs:** `data_bucket_name`, `lambda_function_name`.

What it creates:
- `module "environment"` with `env`, `vercel_target = ["preview"]` and `vercel_git_branch`.
- `aws_iam_role_policy` `bgm-looper-vercel-<env>-resume` on `bgm-looper-vercel-preview`: `ResumeObjects` (`s3:PutObject`, `s3:GetObject` on `<own bucket>/resume/*`) and `ResumeHeadObjectNotFound` (`s3:ListBucket` on the own bucket), with the comment from `shared.tf:265-273`.
- `vercel_project_environment_variable`, target `["preview"]`, `git_branch = var.vercel_git_branch`, for `APP_AWS_ROLE_ARN`, `RESUME_BUCKET_NAME` (the own data bucket), `AVP_POLICY_STORE_ID`, `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID`, `COGNITO_USER_POOL_ID`.

The roots use the same backend, provider and variable shape as Task 6, with key `env/terraform.tfstate`. Variables are `aws_profile` and `vercel_api_token`. Set `bootstrap_image_tag` to `"set-in-task-10"` / `"set-in-task-12"`. The function is created only in Tasks 10 and 12, after a real tag replaces the placeholder.

CORS origins: a map in `modules/environment`, each list exhaustive:

| env | origins |
|---|---|
| main | `https://ashutosh-pandey.com`, `https://bgm-looper.vercel.app`, `http://localhost:3000` |
| dev | `https://dev.ashutosh-pandey.com`, `https://bgm-looper-git-dev-ashutosh-pandeys-projects-77cb3a00.vercel.app`, `http://localhost:3000` |
| stage | `https://stage.ashutosh-pandey.com`, `https://bgm-looper-git-stage-ashutosh-pandeys-projects-77cb3a00.vercel.app`, `http://localhost:3000` |

Keep the comment's reasoning and change "seven origins" to "these origins".

- [ ] **Step 1:** `terraform -chdir=infra/nonprod/dev/env init -backend=false && terraform validate`. Expected: FAIL (missing).
- [ ] **Step 2:** Implement the module, both roots and the CORS map.
- [ ] **Step 3:** Run fmt, validate (both roots, `-backend=false`), tflint and the grep from Task 6 step 5 over `infra/modules/nonprod-env infra/nonprod`. Expected: clean, no output.
- [ ] **Step 4:** Plan `infra/envs/main` as `personal`. Expected: only `aws_s3_bucket_cors_configuration.data` updates in place, `allowed_origins` going 7 → 3. This lands in prod only when promoted to `main`.
- [ ] **Step 5:** Commit as `feat(infra): nonprod env stacks and per-environment CORS`. Open a PR and merge. The push to `dev` applies the CORS narrowing to legacy `envs/dev`, in place.

### Task 8: Pin stage's preview values in legacy `envs/stage`

Stage inherits the bare `preview` values that `shared` sets. Task 10 narrows those to production. This task pins stage first, to the same prod-account values it uses today, from the stack Task 12 destroys.

**Files:**
- Create: `infra/envs/stage/pins.tf`

**Interfaces:**
- **Consumes:** the Task 4 outputs in `shared`'s state (`bgm-looper-tf-state-223376380711`, key `shared/terraform.tfstate`), through `terraform_remote_state`. This reads prod state from a prod-account stack, so the no-prod-read rule doesn't apply. `tf-apply-nonprod` has `ReadOnlyAccess`.

What it creates: `vercel_project_environment_variable`, target `["preview"]`, `git_branch = "stage"`, for `APP_AWS_ROLE_ARN` (= `vercel_preview_role_arn`), `RESUME_BUCKET_NAME`, `AVP_POLICY_STORE_ID`, `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID`, `COGNITO_USER_POOL_ID`. Add a comment: "Temporary: removed with this stack in Task 12 of the nonprod-accounts plan."

- [ ] **Step 1:** `terraform -chdir=infra/envs/stage plan` as `personal`. Expected now: `No changes` (apart from Task 7's CORS change, if stage hasn't been promoted yet).
- [ ] **Step 2:** Implement `pins.tf`.
- [ ] **Step 3:** Plan again. Expected: 6 to add, 0 to destroy, and each value equal to what the Vercel dashboard shows today for that key's bare `preview` value.
- [ ] **Step 4:** Commit as `feat(infra): pin stage's preview values before dev's cutover`. Merge into `dev`, then promote `dev` → `stage`. The push to `stage` applies the 6 pins.
- [ ] **Step 5:** In the Vercel dashboard (Project → Settings → Environment Variables), confirm each of the six keys has a `Preview (stage)` value. Redeploy the latest `stage` deployment, then sign in on `stage.ashutosh-pandey.com`. Expected: it works as before.

### Task 9: dev account base (routing, deploy role, local first apply, seed image)

**Files:**
- Modify: `.github/scripts/tf-stacks.sh` and its test (dev pushes apply `shared envs/dev nonprod/dev/account`; PRs into `dev` plan the same; drift adds `dev:nonprod/dev/account`)
- Modify: `.github/workflows/terraform.yml` (dispatch choices add `nonprod/dev/account`)
- Modify: `.github/workflows/deploy.yml` (dev's `role_arn` = `arn:aws:iam::624586968135:role/bgm-looper-ci-deploy`)

- [ ] **Step 1:** Update the tests for the new dev row (`stacks=shared envs/dev nonprod/dev/account`, dispatch `dev`/`nonprod/dev/account` → `stacks=nonprod/dev/account`). Run them. Expected: FAIL. Implement the routing change. Run again. Expected: PASS.
- [ ] **Step 2: Local first apply, pass 1.** Don't push the branch yet: the PR's plan job needs the dev plan role this creates. On this branch run `terraform -chdir=infra/nonprod/dev/account init`, then `plan -var aws_profile=personal-dev -var webauthn_enabled=false -out=a1.tfplan`. Check that it's creates only, then apply.
- [ ] **Step 3: Pass 2.** `plan -var aws_profile=personal-dev -out=a2.tfplan`. Expected: 1 to change (the pool gains `web_authn_configuration`). Apply. `aws cognito-idp get-user-pool-mfa-config --user-pool-id <id> --profile personal-dev` must show `RelyingPartyId: auth.dev.ashutosh-pandey.com`.
- [ ] **Step 4: By hand (owner):**
  - Add `https://auth.dev.ashutosh-pandey.com/oauth2/idpresponse` to the Google OAuth client.
  - Confirm the SNS subscription email.
  - Click the SES verification email for the owner address.
  - Follow `docs/runbooks/link-owner-google.md` with `--profile personal-dev` and the dev pool ID.
  - Check `aws sesv2 get-email-identity --email-identity dev.ashutosh-pandey.com --profile personal-dev` shows `VerifiedForSendingStatus: true`.
- [ ] **Step 5:** Commit as `ci: route dev's account stack and deploys to 624586968135`. Merge into `dev`. The CI apply of `nonprod/dev/account` must show `No changes`.
- [ ] **Step 6: Seed image.** Run `gh workflow run deploy.yml --ref dev`. Expected log: `Lambda function bgm-looper-processor-dev does not exist yet — skipping update-function-code`. `aws ecr describe-images --repository-name bgm-looper-lambda --profile personal-dev` lists one `dev-<sha>` tag. Record it for Task 10.

### Task 10: dev cutover

**Files:**
- Modify: `infra/nonprod/dev/env/main.tf` (`bootstrap_image_tag` = the Task 9 tag)
- Modify: `infra/shared/shared.tf`, `infra/shared/auth.tf`, `infra/shared/access.tf`. `COGNITO_*`, `AVP_POLICY_STORE_ID` and `RESUME_BUCKET_NAME` change target to `["production"]`. Delete `vercel_project_environment_variable.aws_role_arn_preview`.
- Modify: `.github/scripts/tf-stacks.sh` and its test (dev: `shared nonprod/dev/account nonprod/dev/env`; drift drops `dev:envs/dev`, adds `dev:nonprod/dev/env`)
- Modify: `.github/workflows/terraform.yml` (choices: drop `envs/dev`, add `nonprod/dev/env`)
- Delete: `infra/envs/dev/`

- [ ] **Step 1:** Update the tests and routing. Run `node --test`. Expected: PASS.
- [ ] **Step 2:** Run `terraform -chdir=infra/shared plan` as `personal`. Expected: 1 to destroy (`aws_role_arn_preview`) and 5 in-place target updates, nothing else. In vercel 5.18.0, `target` updates in place, so any replace means stop.
- [ ] **Step 3: Destroy legacy dev.** Do this from a `dev` checkout before the merge, because the PR deletes the directory.
  - `aws s3 rm s3://portfolio-data-dev-223376380711 --recursive --profile personal`
  - `terraform -chdir=infra/envs/dev plan -destroy -out=d.tfplan` as `personal`. Expected: 12 to destroy, every address under `module.environment`.
  - `terraform apply d.tfplan`
- [ ] **Step 4:** Commit as `feat(infra): cut dev over to 624586968135`. Merge into `dev`. The CI apply stops at `shared` on the destroy guard. Run `gh workflow run terraform.yml --ref dev -f stack=shared -f confirm=apply-destroys`, then `gh workflow run terraform.yml --ref dev -f stack=nonprod/dev/env`. Expected: the env stack creates its bucket, Lambda, exec role, alarm, resume policy and 8 Vercel vars.
- [ ] **Step 5:** Redeploy the latest `dev` deployment in Vercel. Then run the spec §6 checks on `dev.ashutosh-pandey.com`:
  - Google sign-in
  - email OTP arrives
  - register a passkey, then sign in with it
  - a gated route allowed when signed in and denied when signed out
  - a track processed
  - a resume uploads and extracts. Publishing waits for Task 13.

  Confirm in CloudWatch (`--profile personal-dev`) that `bgm-looper-processor-dev` logged the invoke.
- [ ] **Step 6:** Push a `lambda/` change (or dispatch `deploy.yml` on `dev`). Expected: `update-function-code` on the dev-account function.

### Task 11: stage account base

Same as Task 9 with these substitutions:
- `stage`, `personal-stage`, 792682047320, `auth.stage.ashutosh-pandey.com`
- the routing row `stage` → `envs/stage nonprod/stage/account`; PRs into `stage` plan the same; drift adds `stage:nonprod/stage/account`
- deploy role `arn:aws:iam::792682047320:role/bgm-looper-ci-deploy`

The PR goes into `dev` and reaches `stage` by promotion. Do the local passes before the promotion merges. Seed with `gh workflow run deploy.yml --ref stage`. Commit as `ci: route stage's account stack and deploys to 792682047320`.

- [ ] **Step 1:** Tests, then routing (stage row). Expected: FAIL before the change, PASS after.
- [ ] **Step 2:** Local pass 1 (`webauthn_enabled=false`), then pass 2, against `infra/nonprod/stage/account` as `personal-stage`. Then check `RelyingPartyId`.
- [ ] **Step 3:** The manual steps from Task 9 step 4, for stage.
- [ ] **Step 4:** Commit and merge into `dev`, then promote to `stage`. The CI apply of `nonprod/stage/account` must show `No changes`.
- [ ] **Step 5:** Seed the image on `stage` and record the `stage-<sha>` tag.

### Task 12: stage cutover

Same as Task 10 for stage:
- set `bootstrap_image_tag` in `infra/nonprod/stage/env/main.tf`
- routing `stage` → `nonprod/stage/account nonprod/stage/env`; drift drops `stage:envs/stage`
- delete `infra/envs/stage/` (its `pins.tf` included)
- the legacy bucket is `portfolio-data-stage-223376380711`
- `shared` doesn't change in this task

- [ ] **Step 1:** Tests, then routing. Expected: PASS.
- [ ] **Step 2: Destroy legacy stage** from a `stage` checkout, before the promotion merges. Empty the bucket, then `plan -destroy`. Expected: 18 to destroy (the 12 under `module.environment` plus the 6 pins). Apply.
- [ ] **Step 3:** Commit as `feat(infra): cut stage over to 792682047320`. Merge into `dev`, then promote to `stage`. If the guard stops the CI apply, dispatch `nonprod/stage/env` on `stage`.
- [ ] **Step 4:** Redeploy the latest `stage` deployment, then run the Task 10 step 5 checks on `stage.ashutosh-pandey.com` against the stage account.

### Task 13: previews publish their own resume

**Files:**
- Modify: `web/app/api/resume/publish/route.ts:13-23`
- Test: `web/app/api/resume/publish/route.test.ts`

- [ ] **Step 1: Precondition.** In Vercel, `RESUME_BUCKET_NAME` for `Preview` must be `portfolio-data-dev-624586968135`, and for `Preview (stage)` `portfolio-data-stage-792682047320`. Neither may be `portfolio-data-223376380711`. If either is wrong, stop.
- [ ] **Step 2: Write the failing tests.**
  - `it("publishes on preview, into the preview's own bucket")`: with `VERCEL_ENV = "preview"`, the response is 200 `{ ok: true }` and every copy targets the mocked `RESUME_BUCKET_NAME`.
  - `it("refuses to publish outside production and preview")`: for `VERCEL_ENV` `"development"` and `undefined`, the response is 403 with `{ error: "publishing is only available on deployed environments" }`.
  - Delete `refuses to publish outside production`.
- [ ] **Step 3:** Run `npm --prefix web run test -- app/api/resume/publish`. Expected: FAIL.
- [ ] **Step 4: Implement.** The guard allows `VERCEL_ENV` `production` or `preview`, with that error copy. Replace the IAM-user comment with the reason: each environment's resume lives in its own account's bucket (nonprod-accounts spec §3), so a preview can't reach production's resume.
- [ ] **Step 5:** Run the tests and `npm --prefix web run lint`. Expected: PASS.
- [ ] **Step 6:** Commit as `feat(resume): previews publish to their own bucket`. Merge into `dev`. After Vercel builds `dev`, publish a draft on `dev.ashutosh-pandey.com`, then check that `/resume` and `/resume.pdf` serve it and production's `/resume` is unchanged. Repeat on `stage` after promotion.

### Task 14: prod cleanup

**Files:**
- Modify: `infra/shared/shared.tf`:
  - delete `aws_iam_role.vercel_preview` and `aws_iam_role_policy.vercel_preview_resume`, and the `vercel_preview_role_arn` output
  - `ci_deploy` trust → `refs/heads/main` only, Lambda resource → main's function only
  - drop ECR lifecycle rules 3 and 4
  - `env_suffix` and the derived maps → `main` only
- Modify: `infra/shared/ci.tf`: delete `tf_apply_nonprod` (role, attachment, document, policy), `nonprod_envs`, and `tf_trust["nonprod"]`.
- Modify: `infra/shared/access.tf`: delete `aws_iam_role_policy.vercel_preview_access`.
- Modify: `infra/shared/auth.tf`: callback URLs → `https://ashutosh-pandey.com/api/auth/callback` only. localhost now signs in against dev.
- Modify: `.github/scripts/tf-stacks.sh` and its test: `role` loses the `envs/dev`/`envs/stage` arms.

- [ ] **Step 1:** Update the tests and routing. Expected: PASS.
- [ ] **Step 2:** Run `terraform -chdir=infra/shared plan` as `personal`. Expected:
  - destroys exactly `aws_iam_role.vercel_preview`, `aws_iam_role_policy.vercel_preview_resume`, `aws_iam_role_policy.vercel_preview_access`, `aws_iam_role.tf_apply_nonprod`, `aws_iam_role_policy_attachment.tf_apply_nonprod_readonly`, `aws_iam_role_policy.tf_apply_nonprod`
  - in-place updates of `ci_deploy`'s trust and policy, the ECR lifecycle policy, and the Cognito client's callback URLs
  - nothing replaced
- [ ] **Step 3:** Commit as `chore(infra): remove dev and stage from the prod account`. Merge into `dev`. Then `gh workflow run terraform.yml --ref dev -f stack=shared -f confirm=apply-destroys`.
- [ ] **Step 4:** Delete the old images. List the `dev-*` and `stage-*` tags with `aws ecr list-images --repository-name bgm-looper-lambda --profile personal`, then `aws ecr batch-delete-image` them. Delete the state objects `envs/dev/terraform.tfstate` and `envs/stage/terraform.tfstate` from `bgm-looper-tf-state-223376380711`.
- [ ] **Step 5: Check.** No `-dev`/`-stage` resource is left in 223376380711:
  - `aws lambda list-functions`, `aws s3 ls`, `aws iam list-roles --query "Roles[?contains(RoleName,'bgm-looper')].RoleName"` (all `--profile personal`)
  - Expected roles: `bgm-looper-ci-deploy`, `-lambda-exec-main`, `-tf-plan`, `-tf-apply-prod`, `-vercel`
- [ ] **Step 6:** Promote to `stage` and `main`. On `main`, `envs/main` applies Task 7's CORS narrowing. Check production sign-in, the Looper, the resume and email OTP.

### Task 15: aws-org: drop the removed prod roles from the archive rules

**Repo:** aws-org, branch `task-16-prod-oidc-roles-cleanup`.

- [ ] **Step 1: Write the failing test.** Assert that `["github"]`'s resource filter doesn't contain `arn:aws:iam::333333333333:role/bgm-looper-tf-apply-nonprod`, and `["vercel"]`'s is exactly `["arn:aws:iam::333333333333:role/bgm-looper-vercel"]`.
- [ ] **Step 2:** Run `terraform -chdir=security test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove `bgm-looper-tf-apply-nonprod` from the prod `github` list and `bgm-looper-vercel-preview` from the prod `vercel` list.
- [ ] **Step 4:** Run the test (expect PASS), then plan. Expected: 2 to change in place, 0 to destroy.
- [ ] **Step 5:** Commit as `chore(security): drop bgm-looper's removed prod roles from the archive rules`. Open a PR, merge, and apply the saved plan.
- [ ] **Step 6:** In Access Analyzer (as `personal-mgmt`, `list-findings` on `org-external-access`, status `ACTIVE`), there must be no active finding for a bgm-looper role in any of the three accounts.

### Task 16: docs

**Files:**
- `docs/runbooks/release-promotion.md:22-24`
- `docs/runbooks/infra-apply-teardown.md:105,167-174`
- `docs/runbooks/incident-tool-down.md:134,150`
- `docs/runbooks/stale-lambda-recovery.md:45`
- `docs/runbooks/README.md:22`
- `ARCHITECTURE.md:32` and the per-branch table
- `CLAUDE.md:85` and Branching
- `.claude/rules/infra.md:37-38,50,63`
- `docs/aws-devops-agent.md:19` (dev and stage are outside the Agent Space)
- `infra/shared/terraform.tfvars.example:27-28` (the Google redirect URIs for all three pools)

- [ ] **Step 1:** Update each to say which account each environment lives in, give the per-account names and the stack paths `infra/nonprod/<env>/{account,env}`, and use `personal-dev`/`personal-stage` in the commands. In `infra.md`, drop the gaps that separate accounts closed (`tf-apply-nonprod`'s inline-policy reach) and keep the Vercel-token gap.
- [ ] **Step 2:** Run `grep -rn "223376380711" docs/runbooks ARCHITECTURE.md CLAUDE.md .claude/rules`. Every remaining hit must be about production.
- [ ] **Step 3:** Commit as `docs: dev and stage live in their own accounts`. Open a PR and merge.
