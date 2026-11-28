# VPN Phase 1: AWS control plane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the AWS half of the VPN control plane:

- the `bgm-looper-vpn` DynamoDB table in each environment, with its Vercel grant and env var;
- production's Roles Anywhere trust anchor, profile and `bgm-looper-vpn-agent` role for the VM;
- the CI permission that production's Terraform apply role needs to create them.

**Architecture:** There are two PRs.

- **PR A** widens `tf_apply_prod`.
- **PR B** adds the table to `infra/modules/app` (so every environment gets one), and the Roles Anywhere resources to `infra/prod/account/vpn.tf` (production only).

PR A must reach `main` in an earlier promotion than PR B. Otherwise production's apply role would be creating Roles Anywhere resources in the same apply that grants it the permission.

**Tech Stack:** Terraform 1.15, `hashicorp/aws ~> 6.62`, `vercel/vercel ~> 5.15`, and openssl, for the CA script.

**Spec:** `docs/superpowers/specs/2026-11-28-oci-wireguard-vpn-design.md`, §1 and §6.

**Change from the spec's phase list:** the Cedar action and the route gate moved to Phase 2's Task 1. Adding the `TOOLS` entry before `/tools/vpn` exists would list a hub link to a 404 page.

## Global Constraints

- Production account `223376380711`, region `us-east-1`. Dev is `624586968135` and stage is `792682047320`.
- Table name `bgm-looper-vpn`:
  - provisioned billing, `read_capacity = 2`, `write_capacity = 2`, no autoscaling;
  - `hash_key = "pk"`, type `S`.
- The role is named `bgm-looper-vpn-agent`, and the trust anchor and profile `bgm-looper-vpn`.
- The certificate CN that the role trusts is `vpn-vm`.
- The Roles Anywhere profile has `duration_seconds = 3600`.
- The CA is EC P-256, valid 3650 days. VM certificates are valid 365 days.
- The CA's private key never enters the repo. `.gitignore` covers `infra/vpn/ca/`.
- The Vercel env var `VPN_TABLE_NAME` is non-sensitive, and scoped per environment exactly like `S3_BUCKET_NAME` (`var.vercel_target`, `var.vercel_git_branch`).
- Every PR into `dev` has an issue first, filed as a sub-issue of epic #591, and says `Closes #N`. It adds a `CHANGELOG.md` entry under `## [Unreleased]`.
- Commits end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.
- Never call Cost Explorer.

## Review Focus

1. **CI plan output:** the PR's `Terraform` comment shows the intended additions only, with no `⚠ destroys or replaces` line. Check this on each infra PR.
2. **Dev and stage previews:** with PR B applied on `dev`, a preview deployment's Vercel role can `GetItem` on `pk=desired`, and is refused `PutItem` on `pk=server`. Task 2 Step 6 checks this by hand.
3. **The agent role:** a session for any certificate CN other than `vpn-vm` is refused by the trust policy. Task 3 Step 5 checks the policy JSON.
4. **The CA script:** it refuses to overwrite an existing CA key, because losing the CA means re-signing the VM. Task 3 Step 2 tests it.
5. **Free tier:** no other table in the organization uses provisioned capacity, because the 25 RCU / 25 WCU always-free allowance is per payer account. Task 2 Step 7 checks this.

---

### Task 1 (PR A): Production's Terraform apply role can manage the VPN's AWS resources

**Files:**
- Modify: `infra/prod/account/terraform-ci-roles.tf` (`data "aws_iam_policy_document" "tf_apply_prod"`, the `ProjectNamedResources` statement and a new statement after it)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: a `tf_apply_prod` that can `dynamodb:*` on `table/bgm-looper-vpn` and `rolesanywhere:*` on this account's trust anchors and profiles. The `iam:*` on `role/${var.project_name}-*` already covers `bgm-looper-vpn-agent`.

- [ ] **Step 1: File the issue**

  ```bash
  gh issue create --title "chore(infra): let production's Terraform role manage the VPN table and Roles Anywhere" \
    --label "area: infra" --label "priority: medium" \
    --body "Phase 1a of #591 (spec docs/superpowers/specs/2026-11-28-oci-wireguard-vpn-design.md §6). tf_apply_prod names only table/site-access-grants for DynamoDB and has nothing for Roles Anywhere."
  ```

  Then add it as a sub-issue of #591 with `gh api repos/DataCrusade1999/supreme-enigma/issues/591/sub_issues -f sub_issue_id=<new issue's id>`.

- [ ] **Step 2: Branch from `dev`**

  ```bash
  git switch dev && git pull && git switch -c chore/<N>-tf-role-vpn
  ```

- [ ] **Step 3: Edit the policy document**

  - Add `"arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/${var.project_name}-vpn"` to `ProjectNamedResources.resources`.
  - Add a statement `sid = "RolesAnywhere"`, with `actions = ["rolesanywhere:*"]` and these resources:
    - `"arn:aws:rolesanywhere:${var.aws_region}:${local.account_id}:trust-anchor/*"`;
    - `"arn:aws:rolesanywhere:${var.aws_region}:${local.account_id}:profile/*"`.
  - Add a statement `sid = "RolesAnywhereCreates"`, with `actions = ["rolesanywhere:CreateTrustAnchor", "rolesanywhere:CreateProfile", "rolesanywhere:TagResource"]` and `resources = ["*"]`.
  - Give each new statement a one-line comment in the file's existing style.

- [ ] **Step 4: Check that the plan role can read Roles Anywhere**

  ```bash
  aws iam simulate-principal-policy --profile personal --region us-east-1 \
    --policy-source-arn arn:aws:iam::223376380711:role/bgm-looper-tf-plan \
    --action-names rolesanywhere:GetTrustAnchor rolesanywhere:GetProfile rolesanywhere:ListTagsForResource \
    --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text
  ```

  Expected: three lines ending `allowed`. For any line saying `implicitDeny`, add that action to `data "aws_iam_policy_document" "tf_plan"` in the same file. That file already does the same for `verifiedpermissions:ListTagsForResource`.

- [ ] **Step 5: Format and lint**

  Run `terraform fmt -check -recursive infra/` and `tflint --chdir=infra --recursive --config="$PWD/infra/.tflint.hcl"`. Expected: no output, exit 0.

- [ ] **Step 6: Add the CHANGELOG entry and commit**

  Under `## [Unreleased]` → `### Changed`, add: "Production's Terraform role can manage the VPN's DynamoDB table and IAM Roles Anywhere (#N)."

  ```bash
  git add infra/prod/account/terraform-ci-roles.tf CHANGELOG.md
  git commit -m "chore(infra): let tf_apply_prod manage the VPN table and Roles Anywhere (#N)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
  ```

- [ ] **Step 7: Push, open the PR into `dev` and read the plan**

  The PR body says `Closes #N` and "Part of #591". The `Terraform` workflow's `prod/account` plan must show exactly one change: an in-place update of `aws_iam_role_policy.tf_apply_prod`. It also changes `tf_plan` if Step 4 added actions. Merge through the `merging-a-pr` skill.

- [ ] **Step 8: Promote to `main` before PR B ships**

  This is a normal `dev → stage → main` promotion, and it needs the owner's approval for each merge into `stage` and `main`. Done when the `Terraform` run on `main` shows `prod/account` applied.

---

### Task 2 (PR B): The `bgm-looper-vpn` table, its Vercel grant and `VPN_TABLE_NAME`, in every environment

**Files:**
- Create: `infra/modules/app/vpn.tf`
- Modify: `infra/modules/app/vercel.tf` (`aws_iam_role_policy.vercel`: add two statements)
- Modify: `infra/modules/app/outputs.tf` (add `vpn_table_arn`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces:
  - `module.environment.aws_dynamodb_table.vpn` in each app stack (`module.env.module.environment…` in the nonprod stacks);
  - the output `vpn_table_arn`;
  - the Vercel env var `VPN_TABLE_NAME = "bgm-looper-vpn"`.
- Phase 2 reads `process.env.VPN_TABLE_NAME`.

- [ ] **Step 1: File the issue and branch**

  Same pattern as Task 1. Title "feat(infra): DynamoDB table for the VPN's desired peers and server report". Branch `feat/<N>-vpn-table`.

- [ ] **Step 2: Write `infra/modules/app/vpn.tf`**

  It holds:
  - `aws_dynamodb_table.vpn`, with the name `"${var.project_name}-vpn"` and the Global Constraints values. Add `point_in_time_recovery { enabled = false }` and `deletion_protection_enabled = true`.
  - `vercel_project_environment_variable.vpn_table_name`, keyed `VPN_TABLE_NAME`, with value `aws_dynamodb_table.vpn.name`, `target = var.vercel_target`, `git_branch = var.vercel_git_branch` and `sensitive = false`.
  - A header comment pointing at the spec, saying that provisioned 2/2 keeps it in the always-free allowance and that only production's table has a VM behind it.

- [ ] **Step 3: Add the Vercel grant statements to `aws_iam_role_policy.vercel`**

  ```hcl
  {
    Sid      = "VpnRead"
    Effect   = "Allow"
    Action   = ["dynamodb:GetItem"]
    Resource = [aws_dynamodb_table.vpn.arn]
  },
  {
    # The dashboard writes only the desired state; the VM writes pk = "server".
    Sid      = "VpnWriteDesired"
    Effect   = "Allow"
    Action   = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
    Resource = [aws_dynamodb_table.vpn.arn]
    Condition = { "ForAllValues:StringEquals" = { "dynamodb:LeadingKeys" = ["desired"] } }
  },
  ```

- [ ] **Step 4: Add the output, then format, validate and lint**

  In `infra/modules/app/outputs.tf`, add `output "vpn_table_arn" { value = aws_dynamodb_table.vpn.arn }`. Then:

  ```bash
  terraform fmt -check -recursive infra/
  terraform -chdir=infra/dev/app init -backend=false && terraform -chdir=infra/dev/app validate
  tflint --chdir=infra --recursive --config="$PWD/infra/.tflint.hcl"
  ```

  Expected: `Success! The configuration is valid.`, and no lint output.

- [ ] **Step 5: Add the CHANGELOG entry, commit, push and open the PR**

  CHANGELOG `### Added`: "A DynamoDB table per environment for the VPN dashboard's peers and the VM's status report (#N)."

  Commit as `feat(infra): add the VPN's DynamoDB table and Vercel grant (#N)`.

  On the PR, the `dev/app` plan shows 2 to add and 1 to change (the policy), with no destroys. The `prod/account` plan shows no change from this PR.

- [ ] **Step 6: After merging to `dev`, check the grant by hand from a preview**

  Run the two calls below as the preview role. Assume it from `personal-dev` with the Vercel OIDC token if you can; otherwise use `aws iam simulate-principal-policy` against `arn:aws:iam::624586968135:role/bgm-looper-vercel-preview`, with `--context-entries` for `dynamodb:LeadingKeys`.

  - `GetItem` on key `{"pk":{"S":"desired"}}`: expected allowed.
  - `PutItem` on key `{"pk":{"S":"server"}}`: expected `implicitDeny`.

- [ ] **Step 7: Check that no other provisioned table in the organization uses the free allowance**

  ```bash
  for p in personal-ro personal-dev-ro personal-stage-ro; do
    aws dynamodb list-tables --profile $p --region us-east-1 --query TableNames --output text | tr '\t' '\n' | while read t; do
      aws dynamodb describe-table --profile $p --region us-east-1 --table-name "$t" \
        --query '[Table.TableName,Table.BillingModeSummary.BillingMode,Table.ProvisionedThroughput.ReadCapacityUnits]' --output text
    done
  done
  ```

  Expected: only `bgm-looper-vpn` shows `PROVISIONED`, or no billing mode with RCU 2. Every other table shows `PAY_PER_REQUEST`.

  This doesn't cover the management account or the aws-org member accounts. Ask the owner to confirm in the management account's Billing console, under "Free tier", that DynamoDB provisioned capacity usage stays under 25 units.

---

### Task 3 (PR B, same branch): The CA scripts, and Roles Anywhere for the VM

**Files:**
- Create: `infra/vpn/scripts/make-ca.sh`
- Create: `infra/vpn/scripts/test-make-ca.sh`
- Create: `infra/prod/account/vpn-ca.pem` (the owner runs the script; this commits the public certificate only)
- Create: `infra/prod/account/vpn.tf`
- Modify: `infra/prod/account/outputs.tf`
- Modify: `.gitignore` (add `infra/vpn/ca/`)

**Interfaces:**
- Produces outputs of `infra/prod/account`, read by Phase 3 with `terraform_remote_state` (bucket `bgm-looper-tf-state-223376380711`, key `shared/terraform.tfstate`):
  - `vpn_trust_anchor_arn`
  - `vpn_profile_arn`
  - `vpn_role_arn`
- Produces `make-ca.sh <outdir>`. It writes `<outdir>/ca.key` (mode 600) and `<outdir>/ca.pem`, and exits 1 without touching anything when `<outdir>/ca.key` exists.

- [ ] **Step 1: Write the failing test `infra/vpn/scripts/test-make-ca.sh`**

  It uses a temporary directory and asserts:
  - the first run exits 0 and creates `ca.key` and `ca.pem`;
  - `openssl x509 -in ca.pem -noout -text` shows `CA:TRUE`, `Certificate Sign` in key usage, and `ASN1 OID: prime256v1`;
  - the `-enddate` is about 3650 days away (between 3640 and 3660);
  - `stat -c %a ca.key` prints `600`;
  - a second run exits 1, and `ca.key`'s sha256 is unchanged.

- [ ] **Step 2: Run it and check that it fails**

  Run `bash infra/vpn/scripts/test-make-ca.sh`. Expected: FAIL (`make-ca.sh: No such file`).

- [ ] **Step 3: Implement `make-ca.sh`**

  - `set -euo pipefail`, and `umask 077`.
  - Refuse if the key exists.
  - `openssl ecparam -name prime256v1 -genkey -noout -out ca.key`.
  - `openssl req -x509 -new -key ca.key -sha256 -days 3650 -subj "/CN=bgm-looper vpn CA"`, with `-addext "basicConstraints=critical,CA:TRUE"` and `-addext "keyUsage=critical,keyCertSign,cRLSign"`.
  - Afterwards, print where to store the key: the owner's password manager, then delete it from disk.

- [ ] **Step 4: Run the test again and check that it passes**

  Run `bash infra/vpn/scripts/test-make-ca.sh`. Expected: `ok`, exit 0.

- [ ] **Step 5: Write `infra/prod/account/vpn.tf`**

  - `aws_rolesanywhere_trust_anchor.vpn`:
    - name `"${var.project_name}-vpn"`, `enabled = true`;
    - `source { source_type = "CERTIFICATE_BUNDLE"; source_data { x509_certificate_data = file("${path.module}/vpn-ca.pem") } }`.
  - `aws_iam_role.vpn_agent`, named `"${var.project_name}-vpn-agent"`. Its trust policy:
    - principal `rolesanywhere.amazonaws.com`;
    - actions `sts:AssumeRole`, `sts:TagSession` and `sts:SetSourceIdentity`;
    - condition `ArnEquals aws:SourceArn = aws_rolesanywhere_trust_anchor.vpn.arn`;
    - condition `StringEquals aws:PrincipalTag/x509Subject/CN = "vpn-vm"`.
  - `aws_iam_role_policy.vpn_agent`, on `arn:aws:dynamodb:${var.aws_region}:${local.account_id}:table/${var.project_name}-vpn`:
    - `dynamodb:GetItem` with `ForAllValues:StringEquals dynamodb:LeadingKeys = ["desired"]`;
    - `dynamodb:PutItem` and `dynamodb:UpdateItem` with `LeadingKeys = ["server"]`.

    Use a literal ARN, not a `prod/app` output: `prod/account` applies first (#524).
  - `aws_rolesanywhere_profile.vpn`: name `"${var.project_name}-vpn"`, `role_arns = [aws_iam_role.vpn_agent.arn]`, `duration_seconds = 3600`, `enabled = true`.
  - In `outputs.tf`, add `vpn_trust_anchor_arn`, `vpn_profile_arn` and `vpn_role_arn`.

- [ ] **Step 6: The owner makes the CA**

  This is an owner action; stop and ask. Run `bash infra/vpn/scripts/make-ca.sh infra/vpn/ca`, store `infra/vpn/ca/ca.key` in the password manager, then `cp infra/vpn/ca/ca.pem infra/prod/account/vpn-ca.pem`.

  Check:
  - `git status --short` shows `infra/prod/account/vpn-ca.pem` and nothing under `infra/vpn/ca/`;
  - `git check-ignore infra/vpn/ca/ca.key` prints the path.

- [ ] **Step 7: Format, lint and validate `prod/account`**

  ```bash
  terraform fmt -check -recursive infra/
  terraform -chdir=infra/prod/account init -backend=false && terraform -chdir=infra/prod/account validate
  tflint --chdir=infra --recursive --config="$PWD/infra/.tflint.hcl"
  ```

  Expected: valid, with no lint output.

- [ ] **Step 8: Add the CHANGELOG entry, commit and push to the PR B branch**

  CHANGELOG `### Added`: "IAM Roles Anywhere trust anchor, profile and role for the VPN VM, with scripts to make the CA (#N)."

  Commit as `feat(infra): add Roles Anywhere for the VPN VM (#N)`.

  The PR's `prod/account` plan shows 4 to add (the trust anchor, role, role policy and profile), and nothing destroyed. Trivy, in the `Tests` check, raises nothing on `vpn-ca.pem`. A certificate is not a secret. If it does flag it, add a `.trivyignore` entry with the reason, in the file's style.

- [ ] **Step 9: Merge and promote**

  Merge through the `merging-a-pr` skill. Phase 3's apply needs this PR on `main`, applied.
