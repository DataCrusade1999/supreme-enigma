# Terraform in CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run every Terraform plan and apply for `infra/shared` and `infra/envs/*` in GitHub Actions through three OIDC roles, with plans on PRs, applies on push, a destroy guard, and weekly drift detection.

**Architecture:** PR 1 adds the three IAM roles (`infra/shared/ci.tf`) and the `tflint` config, applied once from the workstation. PR 2 adds `.github/workflows/terraform.yml` and a tested Node helper, `.github/scripts/tf-summary.mjs`, that turns plan JSON into the PR comment, the job summary and the destroy count. The rollout then proves apply, guard and drift on `dev` before promotion.

**Tech Stack:** GitHub Actions; Terraform 1.15.1 (`hashicorp/setup-terraform@v4.0.1`); tflint v0.64.0 with `tflint-ruleset-aws` v0.49.0 (`terraform-linters/setup-tflint@v6.3.2`); `actions/cache@v6.1.0`; Trivy (`aquasecurity/trivy-action@v0.36.0`, as in `deploy.yml`); Node 22 `node:test` for the helper.

**Spec:** `docs/superpowers/specs/2026-10-02-terraform-ci-design.md` (issue #339)

## Global Constraints

- Account `223376380711`, region `us-east-1`, state bucket `bgm-looper-tf-state-223376380711`. Role names: `bgm-looper-tf-plan`, `bgm-looper-tf-apply-nonprod`, `bgm-looper-tf-apply-prod`.
- Every action pinned by full SHA with a version comment:
  - `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`
  - `hashicorp/setup-terraform@dfe3c3f87815947d99a8997f908cb6525fc44e9e # v4.0.1`
  - `terraform-linters/setup-tflint@6ffdbaa3be476b3431f7275c26966ef32ff60337 # v6.3.2`
  - `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0`
  - `aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd # v6.3.0`
  - `aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0`
- Top-level `permissions: {}`; each job grants only what it uses.
- **Never upload a plan file or plan JSON as an artifact or print the JSON.** `terraform show -json` contains sensitive values in plain text. Only the redacted `terraform show -no-color` text goes to comments and summaries.
- Local commands: `export AWS_PROFILE=personal`; `aws` CLI with `--profile personal --region us-east-1`. Local applies from a saved, counted plan.
- Commits reference `#339` and end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`. `merging-a-pr` skill before every merge.
- `$SP` is `C:/Users/ashut/AppData/Local/Temp/claude/E--Personal-looper/9e68e70b-3bfd-424a-b7c1-07c59f942930/scratchpad`.

## Review Focus

1. **Lock files lacking Linux hashes.** Lock files written on Windows may hold only Windows `h1:` hashes; `init -lockfile=readonly` on the Linux runner would then fail. Task 1 adds `linux_amd64` hashes; PR 2's own run proves it.
2. **A replace slipping past the guard.** Terraform encodes a replace as `["delete","create"]` or `["create","delete"]`. `countDeletes` must count both; Task 4's tests pin it.
3. **A stack applied from the wrong branch** through `workflow_dispatch`. The `Resolve stacks` step refuses a mismatch; Task 7 Step 4 exercises it.
4. **Fork PRs obtaining the plan role.** Depends on the repo setting staying off; Task 3 Step 4 checks it.
5. **Nonprod scope.** The policy simulator in Task 3 must show the denials the spec lists; an allow there means the inline policy is too broad.

---

### Task 1: tflint config, Linux lock hashes, lint fixes

**Files:**
- Create: `infra/.tflint.hcl`
- Modify: `infra/*/.terraform.lock.hcl`, `infra/envs/*/.terraform.lock.hcl`, and any `.tf` tflint flags

- [ ] **Step 1: Install tflint locally**

```bash
cd "$SP" && curl -sSLo tflint.zip https://github.com/terraform-linters/tflint/releases/download/v0.64.0/tflint_windows_amd64.zip && unzip -o tflint.zip >/dev/null && ./tflint.exe --version
```
Expected: `TFLint version 0.64.0`.

- [ ] **Step 2: `infra/.tflint.hcl`**

```hcl
# Used by the `terraform` workflow and locally: tflint --chdir=infra --recursive
# --config="$PWD/infra/.tflint.hcl". The aws plugin catches values `validate` cannot
# (an invalid Lambda runtime or instance type, a malformed ARN).
config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "0.49.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
```

- [ ] **Step 3: Run it and record the findings**

```bash
cd /e/Personal/looper
"$SP/tflint.exe" --chdir=infra --init --config="$PWD/infra/.tflint.hcl"
"$SP/tflint.exe" --chdir=infra --recursive --config="$PWD/infra/.tflint.hcl" --format=compact > "$SP/tflint.txt"; echo rc=$?; cat "$SP/tflint.txt"
```
Expected: some findings (likely `terraform_unused_declarations`, `terraform_required_version`/`required_providers` in the module). Fix each in code. A finding that is deliberate gets a `# tflint-ignore: <rule> — <reason>` comment on the line above, not a config-wide disable. `infra/bootstrap` is linted too.

- [ ] **Step 4: Re-run until clean, then prove no live change**

```bash
"$SP/tflint.exe" --chdir=infra --recursive --config="$PWD/infra/.tflint.hcl"; echo rc=$?
export AWS_PROFILE=personal
for d in shared envs/dev envs/stage envs/main; do (cd infra/$d && terraform plan -var-file=terraform.tfvars -detailed-exitcode -input=false >/dev/null 2>&1; echo "$d exit=$?"); done
```
Expected: `rc=0`; four `exit=0`.

- [ ] **Step 5: Linux hashes in every lock file**

```bash
for d in shared envs/dev envs/stage envs/main bootstrap; do (cd infra/$d && terraform providers lock -platform=linux_amd64 -platform=windows_amd64 >/dev/null && echo "$d ok"); done
git diff --stat -- 'infra/**/.terraform.lock.hcl'
```
Expected: five `ok`; each lock file gains `h1:` lines, no version changes (`git diff` shows only added hash lines).

- [ ] **Step 6: Commit**

```bash
git add infra
git commit -m "chore(infra): add tflint config, fix its findings, add linux lock hashes

Refs #339

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 2: The three CI roles

**Files:**
- Create: `infra/shared/ci.tf`

**Interfaces:**
- Produces: roles `bgm-looper-tf-plan`, `bgm-looper-tf-apply-nonprod`, `bgm-looper-tf-apply-prod` (ARN `arn:aws:iam::223376380711:role/<name>`), consumed by Task 5's workflow.

- [ ] **Step 1: Write `infra/shared/ci.tf`**

```hcl
# Terraform in CI (#339): one read-only plan role and two apply roles, assumed by
# .github/workflows/terraform.yml through the GitHub OIDC provider in shared.tf. Every
# trust policy uses StringEquals on explicit subjects, never a wildcard — see the
# ci_deploy role's comment for why. The workstation's `personal` credentials stay the
# break-glass path if CI ever locks itself out.

locals {
  tf_state_bucket_arn = "arn:aws:s3:::bgm-looper-tf-state-${data.aws_caller_identity.current.account_id}"
  account_id          = data.aws_caller_identity.current.account_id

  nonprod_envs = ["dev", "stage"]
}

data "aws_iam_policy_document" "tf_trust" {
  for_each = {
    plan    = ["${local.github_sub_prefix}:pull_request", "${local.github_sub_prefix}:ref:refs/heads/dev"]
    nonprod = ["${local.github_sub_prefix}:ref:refs/heads/dev", "${local.github_sub_prefix}:ref:refs/heads/stage"]
    prod    = ["${local.github_sub_prefix}:ref:refs/heads/main"]
  }

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = each.value
    }
  }
}

# PR plans and the weekly drift plan. Plans run with -lock=false, so read-only is
# enough. ReadOnlyAccess includes the state files, which hold secrets in plain text —
# the same people can read the repository secrets, so this adds no exposure. Fork PRs
# get no OIDC token while the repo's "send secrets to fork PRs" setting stays off.
resource "aws_iam_role" "tf_plan" {
  name               = "${var.project_name}-tf-plan"
  assume_role_policy = data.aws_iam_policy_document.tf_trust["plan"].json
}

resource "aws_iam_role_policy_attachment" "tf_plan_readonly" {
  role       = aws_iam_role.tf_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# Pushes to dev and stage. Writes are limited by name to dev's and stage's resources
# and state, so code that has only reached dev cannot change production in AWS. Two
# gaps, both in the spec §9: iam:PutRolePolicy has no policy-name condition, so this
# role can write any inline policy on the preview Vercel role; and the Vercel token is
# account-wide. Deleting a bucket or a function is excluded on purpose: that needs a
# local apply even when the destroy guard is overridden.
resource "aws_iam_role" "tf_apply_nonprod" {
  name               = "${var.project_name}-tf-apply-nonprod"
  assume_role_policy = data.aws_iam_policy_document.tf_trust["nonprod"].json
}

resource "aws_iam_role_policy_attachment" "tf_apply_nonprod_readonly" {
  role       = aws_iam_role.tf_apply_nonprod.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "tf_apply_nonprod" {
  statement {
    sid       = "State"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = [for e in local.nonprod_envs : "${local.tf_state_bucket_arn}/envs/${e}/*"]
  }
  statement {
    sid         = "Buckets"
    actions   = ["s3:*"]
    resources = flatten([for e in local.nonprod_envs : [
      "arn:aws:s3:::${local.data_bucket_names[e]}",
      "arn:aws:s3:::${local.data_bucket_names[e]}/*",
    ]])
  }
  statement {
    sid       = "NoBucketDelete"
    effect    = "Deny"
    actions   = ["s3:DeleteBucket"]
    resources = [for e in local.nonprod_envs : "arn:aws:s3:::${local.data_bucket_names[e]}"]
  }
  statement {
    sid       = "Functions"
    actions   = ["lambda:*"]
    resources = [for e in local.nonprod_envs : "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${local.lambda_function_names[e]}"]
  }
  statement {
    sid       = "NoFunctionDelete"
    effect    = "Deny"
    actions   = ["lambda:DeleteFunction"]
    resources = [for e in local.nonprod_envs : "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${local.lambda_function_names[e]}"]
  }
  statement {
    sid       = "Alarms"
    actions   = ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:TagResource", "cloudwatch:UntagResource"]
    resources = [for e in local.nonprod_envs : "arn:aws:cloudwatch:${var.aws_region}:${local.account_id}:alarm:${local.lambda_function_names[e]}-invocation-rate"]
  }
  statement {
    sid = "ExecRoles"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy",
      "iam:TagRole", "iam:UntagRole",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy",
      "iam:PutRolePolicy", "iam:DeleteRolePolicy",
    ]
    resources = [for e in local.nonprod_envs : "arn:aws:iam::${local.account_id}:role/${var.project_name}-lambda-exec-${e}"]
  }
  statement {
    sid       = "PassExecRoles"
    actions   = ["iam:PassRole"]
    resources = [for e in local.nonprod_envs : "arn:aws:iam::${local.account_id}:role/${var.project_name}-lambda-exec-${e}"]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }
  statement {
    sid       = "PreviewRolePolicies"
    actions   = ["iam:PutRolePolicy", "iam:DeleteRolePolicy"]
    resources = [aws_iam_role.vercel_preview.arn]
  }
}

resource "aws_iam_role_policy" "tf_apply_nonprod" {
  name   = "${var.project_name}-tf-apply-nonprod"
  role   = aws_iam_role.tf_apply_nonprod.id
  policy = data.aws_iam_policy_document.tf_apply_nonprod.json
}

# Pushes to main and manual runs on main: shared and envs/main. Every service the
# stacks manage, with IAM limited to this project's names. It can edit its own role —
# inherent to letting CI manage the roles; a local apply is the way back.
resource "aws_iam_role" "tf_apply_prod" {
  name               = "${var.project_name}-tf-apply-prod"
  assume_role_policy = data.aws_iam_policy_document.tf_trust["prod"].json
}

resource "aws_iam_role_policy_attachment" "tf_apply_prod_readonly" {
  role       = aws_iam_role.tf_apply_prod.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "tf_apply_prod" {
  statement {
    sid       = "State"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.tf_state_bucket_arn}/shared/*", "${local.tf_state_bucket_arn}/envs/main/*"]
  }
  statement {
    sid = "Services"
    actions = [
      "s3:*", "lambda:*", "cloudwatch:*", "sns:*", "budgets:*", "ecr:*",
      "cognito-idp:*", "ses:*", "acm:*", "logs:*",
    ]
    resources = ["*"]
  }
  statement {
    sid     = "ProjectIam"
    actions = ["iam:*"]
    resources = [
      "arn:aws:iam::${local.account_id}:role/${var.project_name}-*",
      "arn:aws:iam::${local.account_id}:policy/${var.project_name}-*",
      aws_iam_openid_connect_provider.github.arn,
      aws_iam_openid_connect_provider.vercel.arn,
    ]
  }
  statement {
    sid       = "NoStateBucketChanges"
    effect    = "Deny"
    actions   = ["s3:DeleteBucket", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutBucketVersioning", "s3:PutLifecycleConfiguration"]
    resources = [local.tf_state_bucket_arn]
  }
}

resource "aws_iam_role_policy" "tf_apply_prod" {
  name   = "${var.project_name}-tf-apply-prod"
  role   = aws_iam_role.tf_apply_prod.id
  policy = data.aws_iam_policy_document.tf_apply_prod.json
}
```
The `NoStateBucketChanges` deny protects the state bucket, which `infra/bootstrap` owns, from the `s3:*` grant; the spec's §6.3 does not list it, and this plan adds it — record it as a ruling.

- [ ] **Step 2: Validate and lint**

```bash
cd /e/Personal/looper/infra/shared
terraform fmt -check && terraform validate
"$SP/tflint.exe" --chdir=.. --recursive --config="$(cd .. && pwd)/.tflint.hcl"
```
Expected: valid, tflint clean.

- [ ] **Step 3: Commit**

```bash
cd /e/Personal/looper
git add infra/shared/ci.tf
git commit -m "feat(infra): add the Terraform CI plan and apply roles

Refs #339

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 3: Apply the roles locally, prove the scope, set secrets

**Files:** none.

- [ ] **Step 1: Plan, check, apply**

```bash
export AWS_PROFILE=personal
cd /e/Personal/looper/infra/shared
terraform plan -var-file=terraform.tfvars -input=false -no-color -out=$SP/ci-roles.tfplan > $SP/ci-roles.txt 2>&1; echo rc=$?
grep -E '^Plan:|# .* will be' $SP/ci-roles.txt
```
Expected: `Plan: 8 to add, 0 to change, 0 to destroy.` — three roles, three `ReadOnlyAccess` attachments, two inline policies (`tf_apply_nonprod`, `tf_apply_prod`). Then:
```bash
terraform apply -input=false $SP/ci-roles.tfplan && rm $SP/ci-roles.tfplan
terraform plan -var-file=terraform.tfvars -detailed-exitcode -input=false >/dev/null 2>&1; echo exit=$?
```
Expected: `8 added, 0 changed, 0 destroyed`; `exit=0`.

- [ ] **Step 2: Policy simulator — nonprod denials and allows** (Review Focus 5)

```bash
A=arn:aws:iam::223376380711
sim() { aws iam simulate-principal-policy --policy-source-arn $A:role/bgm-looper-tf-apply-nonprod --action-names "$1" --resource-arns "$2" --query 'EvaluationResults[0].EvalDecision' --output text --profile personal --region us-east-1; }
echo "deny  $(sim s3:PutBucketPolicy arn:aws:s3:::portfolio-data-223376380711)"
echo "deny  $(sim lambda:UpdateFunctionConfiguration arn:aws:lambda:us-east-1:223376380711:function:bgm-looper-processor)"
echo "deny  $(sim iam:PutRolePolicy $A:role/bgm-looper-vercel)"
echo "deny  $(sim s3:PutObject arn:aws:s3:::bgm-looper-tf-state-223376380711/shared/terraform.tfstate)"
echo "deny  $(sim s3:DeleteBucket arn:aws:s3:::portfolio-data-dev-223376380711)"
echo "allow $(sim s3:PutBucketPolicy arn:aws:s3:::portfolio-data-dev-223376380711)"
echo "allow $(sim lambda:UpdateFunctionConfiguration arn:aws:lambda:us-east-1:223376380711:function:bgm-looper-processor-stage)"
echo "allow $(sim s3:PutObject arn:aws:s3:::bgm-looper-tf-state-223376380711/envs/dev/terraform.tfstate)"
```
Expected: each line's simulator result matches its label: `implicitDeny` or `explicitDeny` on the `deny` lines, `allowed` on the `allow` lines. Any mismatch: fix `ci.tf`, re-run Step 1 (now an update) and this step.

- [ ] **Step 3: Owner sets the secrets and variables** — **owner checkpoint**

The owner runs this from the repo root in their own shell (prefix with `!` in Claude Code). It reads `infra/shared/terraform.tfvars` and pipes each value to `gh` without printing it:
```bash
v() { sed -n "s/^$1[[:space:]]*=[[:space:]]*\"\(.*\)\"[[:space:]]*$/\1/p" infra/shared/terraform.tfvars; }
for k in vercel_api_token app_password openrouter_api_key google_client_secret; do v $k | gh secret set "TF_VAR_$(echo $k | tr a-z A-Z)"; done
for k in github_repo alert_email google_client_id; do gh variable set "TF_VAR_$(echo $k | tr a-z A-Z)" --body "$(v $k)"; done
gh secret list; gh variable list
```
Expected: four secrets `TF_VAR_VERCEL_API_TOKEN`, `TF_VAR_APP_PASSWORD`, `TF_VAR_OPENROUTER_API_KEY`, `TF_VAR_GOOGLE_CLIENT_SECRET`; three variables. **STOP** until the owner confirms.

- [ ] **Step 4: Fork-PR setting** (Review Focus 4)

```bash
gh api repos/DataCrusade1999/supreme-enigma/actions/permissions/fork-pr-workflows-private-repos 2>&1 | head -5
```
Expected: `send_write_tokens_to_workflows: false` and `send_secrets_and_variables: false`. If the endpoint is unavailable on this plan, ask the owner to confirm in Settings → Actions → General → "Fork pull request workflows" that both boxes are off.

- [ ] **Step 5: `drift` label**

```bash
gh label create drift --color B60205 --description "Terraform drift found by the weekly plan" 2>&1 | tail -1
```

---

### Task 4: `tf-summary.mjs` — plan summary, comment, destroy count (TDD)

**Files:**
- Create: `.github/scripts/tf-summary.mjs`, `.github/scripts/tf-summary.test.mjs`

**Interfaces:**
- Produces (CLI, used by Task 5):
  - `node .github/scripts/tf-summary.mjs deletes <plan.json>` → prints the number of resources the plan deletes or replaces, and their addresses one per line on stderr.
  - `node .github/scripts/tf-summary.mjs comment <dir> <title>` → reads every `<dir>/<name>.json` with its `<dir>/<name>.txt`, prints the markdown comment (first line `<!-- terraform-plan -->`) to stdout, and appends it to `$GITHUB_STEP_SUMMARY` when set. `<name>` is the stack with `/` replaced by `-`.
- Exported: `summarize(plan) → { add, change, destroy, replace: string[], deletes: string[] }`, `renderComment(stacks, title) → string` where `stacks = [{ name, plan, text }]`.

- [ ] **Step 1: Write the failing tests** — `.github/scripts/tf-summary.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, renderComment, MAX_COMMENT } from "./tf-summary.mjs";

const rc = (address, actions) => ({ address, change: { actions } });
const plan = (...changes) => ({ resource_changes: changes });

test("no changes: no-op and read are ignored", () => {
  const s = summarize(plan(rc("a.x", ["no-op"]), rc("data.b.y", ["read"])));
  assert.deepEqual(s, { add: 0, change: 0, destroy: 0, replace: [], deletes: [] });
});

test("a plan with no resource_changes key is no changes", () => {
  assert.deepEqual(summarize({}), { add: 0, change: 0, destroy: 0, replace: [], deletes: [] });
});

test("create, update and delete are counted like terraform's Plan: line", () => {
  const s = summarize(plan(rc("a.new", ["create"]), rc("a.upd", ["update"]), rc("a.gone", ["delete"])));
  assert.equal(s.add, 1);
  assert.equal(s.change, 1);
  assert.equal(s.destroy, 1);
  assert.deepEqual(s.deletes, ["a.gone"]);
});

test("both replace orders count as one add, one destroy and a delete", () => {
  const s = summarize(plan(rc("a.r1", ["delete", "create"]), rc("a.r2", ["create", "delete"])));
  assert.equal(s.add, 2);
  assert.equal(s.destroy, 2);
  assert.deepEqual(s.replace, ["a.r1", "a.r2"]);
  assert.deepEqual(s.deletes, ["a.r1", "a.r2"]);
});

test("comment: marker first, No changes stack, counts, warning only when deleting", () => {
  const md = renderComment(
    [
      { name: "shared", plan: plan(rc("a.x", ["no-op"])), text: "No changes." },
      { name: "envs/dev", plan: plan(rc("a.r", ["delete", "create"]), rc("a.n", ["create"])), text: "plan text" },
    ],
    "PR plan",
  );
  assert.equal(md.split("\n")[0], "<!-- terraform-plan -->");
  assert.match(md, /### `shared` — No changes/);
  assert.match(md, /### `envs\/dev` — 2 to add, 0 to change, 1 to destroy/);
  assert.match(md, /⚠ destroys or replaces: `a\.r`/);
  assert.equal((md.match(/⚠/g) ?? []).length, 1);
  assert.match(md, /<details>[\s\S]*plan text[\s\S]*<\/details>/);
});

test("comment: plan text containing ``` cannot close the fence early", () => {
  const md = renderComment([{ name: "shared", plan: plan(rc("a", ["update"])), text: "x\n```\ny" }], "t");
  assert.match(md, /````\n/);
});

test("comment: truncated under GitHub's limit with a pointer to the job summary", () => {
  const md = renderComment([{ name: "shared", plan: plan(rc("a", ["update"])), text: "z".repeat(200000) }], "t");
  assert.ok(md.length <= MAX_COMMENT, `length ${md.length}`);
  assert.match(md, /truncated — the full plan is in the job summary/);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd /e/Personal/looper && node --test .github/scripts/tf-summary.test.mjs 2>&1 | tail -5
```
Expected: failure — `Cannot find module` for `./tf-summary.mjs`.

- [ ] **Step 3: Implement `.github/scripts/tf-summary.mjs`**

```js
// Renders Terraform plans for the `terraform` workflow: the PR comment, the job
// summary, and the destroy count the apply job's guard reads. Input is
// `terraform show -json` (counts and addresses only — its values are never printed,
// since that JSON holds sensitive values in plain text) plus the redacted
// `terraform show -no-color` text.
import { readFileSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fence } from "./summary-lib.mjs";

export const MARKER = "<!-- terraform-plan -->";
// GitHub rejects comment bodies over 65,536 characters; leave room for the frame.
export const MAX_COMMENT = 65000;

export function summarize(plan) {
  const s = { add: 0, change: 0, destroy: 0, replace: [], deletes: [] };
  for (const { address, change } of plan.resource_changes ?? []) {
    const a = change.actions;
    const del = a.includes("delete");
    const create = a.includes("create");
    if (del && create) s.replace.push(address);
    if (create) s.add++;
    if (a.includes("update")) s.change++;
    if (del) {
      s.destroy++;
      s.deletes.push(address);
    }
  }
  return s;
}

function section({ name, plan, text }) {
  const s = summarize(plan);
  if (s.add + s.change + s.destroy === 0) return `### \`${name}\` — No changes\n`;
  const lines = [`### \`${name}\` — ${s.add} to add, ${s.change} to change, ${s.destroy} to destroy`];
  if (s.deletes.length) lines.push("", `⚠ destroys or replaces: ${s.deletes.map((d) => `\`${d}\``).join(", ")}`);
  const f = fence(text);
  lines.push("", "<details><summary>Plan</summary>", "", `${f}\n${text}\n${f}`, "", "</details>");
  return lines.join("\n") + "\n";
}

export function renderComment(stacks, title) {
  const head = `${MARKER}\n## ${title}\n\n`;
  let md = head + stacks.map(section).join("\n");
  if (md.length > MAX_COMMENT) {
    const note = "\n\n_…truncated — the full plan is in the job summary._\n";
    md = md.slice(0, MAX_COMMENT - note.length - 10) + "\n```\n" + note;
  }
  return md;
}

function main([cmd, ...args]) {
  if (cmd === "deletes") {
    const s = summarize(JSON.parse(readFileSync(args[0], "utf8")));
    for (const d of s.deletes) console.error(d);
    console.log(s.deletes.length);
    return;
  }
  if (cmd === "comment") {
    const [dir, title] = args;
    const stacks = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const base = f.slice(0, -5);
        return {
          name: base.replace("-", "/"),
          plan: JSON.parse(readFileSync(join(dir, f), "utf8")),
          text: readFileSync(join(dir, `${base}.txt`), "utf8"),
        };
      });
    const md = renderComment(stacks, title);
    process.stdout.write(md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    return;
  }
  console.error("usage: tf-summary.mjs deletes <plan.json> | comment <dir> <title>");
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
```
`name: base.replace("-", "/")` turns `envs-dev` back into `envs/dev` and leaves `shared` alone; only the first `-` is replaced, which is the separator the workflow writes.

- [ ] **Step 4: Run and watch them pass, then the whole script suite**

```bash
node --test .github/scripts/tf-summary.test.mjs 2>&1 | tail -4
node --test ".github/scripts/*.test.mjs" 2>&1 | tail -4
```
Expected: `# pass 7`, `# fail 0`; the whole suite also `# fail 0` (this suite gates `deploy` in `deploy.yml`).

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/tf-summary.mjs .github/scripts/tf-summary.test.mjs
git commit -m "feat(ci): render Terraform plans and count destroys for the terraform workflow

Refs #339

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 5: The workflow

**Files:**
- Create: `.github/workflows/terraform.yml`

**Interfaces:**
- Consumes: Task 2's role names; Task 3's secrets and variables; Task 4's CLI.

- [ ] **Step 1: Write `.github/workflows/terraform.yml`**

```yaml
# Terraform in CI (#339, docs/superpowers/specs/2026-10-02-terraform-ci-design.md).
# PRs plan, pushes apply, a plan that deletes or replaces anything stops for a
# manual `apply-destroys` run, and a weekly plan files drift as an issue.
# One job per event: GitHub bills each job rounded up to a minute (#320).
# Never upload or print a plan's JSON — it holds sensitive values in plain text.
name: Terraform

on:
  pull_request:
    branches: [dev, stage, main]
    paths: ["infra/**", ".github/workflows/terraform.yml", ".github/scripts/tf-summary.mjs"]
  push:
    branches: [dev, stage, main]
    paths: ["infra/**", ".github/workflows/terraform.yml", ".github/scripts/tf-summary.mjs"]
  schedule:
    - cron: "30 3 * * 1"
  workflow_dispatch:
    inputs:
      stack:
        description: "Stack to apply from this branch, or drift"
        required: true
        type: choice
        options: [envs/dev, envs/stage, envs/main, shared, drift]
      confirm:
        description: "Type apply-destroys to apply a plan that deletes or replaces resources"
        required: false
        default: ""

permissions: {}

env:
  TF_IN_AUTOMATION: "1"
  TF_INPUT: "0"
  TF_PLUGIN_CACHE_DIR: ${{ github.workspace }}/.terraform-plugin-cache
  ROLE_PREFIX: arn:aws:iam::223376380711:role/bgm-looper-tf
  TF_VAR_vercel_api_token: ${{ secrets.TF_VAR_VERCEL_API_TOKEN }}
  TF_VAR_app_password: ${{ secrets.TF_VAR_APP_PASSWORD }}
  TF_VAR_openrouter_api_key: ${{ secrets.TF_VAR_OPENROUTER_API_KEY }}
  TF_VAR_google_client_secret: ${{ secrets.TF_VAR_GOOGLE_CLIENT_SECRET }}
  TF_VAR_github_repo: ${{ vars.TF_VAR_GITHUB_REPO }}
  TF_VAR_alert_email: ${{ vars.TF_VAR_ALERT_EMAIL }}
  TF_VAR_google_client_id: ${{ vars.TF_VAR_GOOGLE_CLIENT_ID }}

jobs:
  plan:
    # Dependabot's runs get neither these secrets nor an OIDC token. Its Terraform
    # bumps land through an owner-opened batch PR (merging-a-pr skill), which is planned.
    if: github.event_name == 'pull_request' && github.actor != 'dependabot[bot]'
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    permissions:
      id-token: write
      contents: read
      pull-requests: write
    concurrency:
      group: terraform-pr-${{ github.event.pull_request.number }}
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: hashicorp/setup-terraform@dfe3c3f87815947d99a8997f908cb6525fc44e9e # v4.0.1
        with:
          terraform_version: 1.15.1
          terraform_wrapper: false
      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: ${{ env.TF_PLUGIN_CACHE_DIR }}
          key: tf-plugins-${{ hashFiles('infra/**/.terraform.lock.hcl') }}
      - uses: terraform-linters/setup-tflint@6ffdbaa3be476b3431f7275c26966ef32ff60337 # v6.3.2
        with:
          tflint_version: v0.64.0
      - uses: aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd # v6.3.0
        with:
          role-to-assume: ${{ env.ROLE_PREFIX }}-plan
          aws-region: us-east-1
      - name: Lint
        run: |
          mkdir -p "$TF_PLUGIN_CACHE_DIR"
          terraform fmt -check -recursive infra/
          tflint --chdir=infra --init --config="$GITHUB_WORKSPACE/infra/.tflint.hcl"
          tflint --chdir=infra --recursive --config="$GITHUB_WORKSPACE/infra/.tflint.hcl"
      - name: Plan
        env:
          BASE: ${{ github.base_ref }}
        run: |
          mkdir -p plans
          for stack in shared "envs/$BASE"; do
            name=${stack//\//-}
            echo "::group::$stack"
            terraform -chdir="infra/$stack" init -lockfile=readonly
            terraform -chdir="infra/$stack" validate
            # One retry: Vercel's framework-list endpoint times out now and then.
            terraform -chdir="infra/$stack" plan -lock=false -out=tfplan \
              || { sleep 15; terraform -chdir="infra/$stack" plan -lock=false -out=tfplan; }
            terraform -chdir="infra/$stack" show -json tfplan > "plans/$name.json"
            terraform -chdir="infra/$stack" show -no-color tfplan > "plans/$name.txt"
            echo "::endgroup::"
          done
      - name: Scan plans
        uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0
        with:
          scan-type: config
          scan-ref: plans
          severity: HIGH,CRITICAL
          exit-code: "1"
          trivyignores: .trivyignore
      - name: Comment
        if: always() && hashFiles('plans/*.json') != ''
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        run: |
          node .github/scripts/tf-summary.mjs comment plans "Terraform plan" > comment.md
          id=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" --paginate \
            --jq '[.[] | select(.body | startswith("<!-- terraform-plan -->"))][0].id // empty')
          if [ -n "$id" ]; then
            gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -F body=@comment.md >/dev/null
          else
            gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" -F body=@comment.md >/dev/null
          fi

  apply:
    if: github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.stack != 'drift')
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      id-token: write
      contents: read
    concurrency:
      group: terraform-apply-${{ github.ref_name }}
      cancel-in-progress: false
    steps:
      - name: Resolve stacks
        id: stacks
        env:
          EVENT: ${{ github.event_name }}
          BRANCH: ${{ github.ref_name }}
          INPUT: ${{ inputs.stack }}
        run: |
          case "$BRANCH" in
            dev)   owned="envs/dev";        role=apply-nonprod ;;
            stage) owned="envs/stage";      role=apply-nonprod ;;
            main)  owned="shared envs/main"; role=apply-prod ;;
            *) echo "::error::Terraform applies only from dev, stage or main"; exit 1 ;;
          esac
          if [ "$EVENT" = workflow_dispatch ]; then
            case " $owned " in
              *" $INPUT "*) owned="$INPUT" ;;
              *) echo "::error::$INPUT is not applied from $BRANCH (this branch owns: $owned)"; exit 1 ;;
            esac
          fi
          echo "list=$owned" >> "$GITHUB_OUTPUT"
          echo "role=$role" >> "$GITHUB_OUTPUT"
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: hashicorp/setup-terraform@dfe3c3f87815947d99a8997f908cb6525fc44e9e # v4.0.1
        with:
          terraform_version: 1.15.1
          terraform_wrapper: false
      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: ${{ env.TF_PLUGIN_CACHE_DIR }}
          key: tf-plugins-${{ hashFiles('infra/**/.terraform.lock.hcl') }}
      - uses: aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd # v6.3.0
        with:
          role-to-assume: ${{ env.ROLE_PREFIX }}-${{ steps.stacks.outputs.role }}
          aws-region: us-east-1
      - name: Plan and apply
        env:
          STACKS: ${{ steps.stacks.outputs.list }}
          CONFIRM: ${{ inputs.confirm }}
        run: |
          mkdir -p "$TF_PLUGIN_CACHE_DIR"
          for stack in $STACKS; do
            echo "::group::$stack"
            terraform -chdir="infra/$stack" init -lockfile=readonly
            set +e
            terraform -chdir="infra/$stack" plan -detailed-exitcode -out=tfplan
            rc=$?
            # One retry: Vercel's framework-list endpoint times out now and then.
            if [ $rc -eq 1 ]; then sleep 15; terraform -chdir="infra/$stack" plan -detailed-exitcode -out=tfplan; rc=$?; fi
            set -e
            echo "::endgroup::"
            if [ $rc -eq 0 ]; then echo "### \`$stack\` — No changes" >> "$GITHUB_STEP_SUMMARY"; continue; fi
            [ $rc -eq 2 ] || { echo "::error::plan failed for $stack"; exit 1; }
            terraform -chdir="infra/$stack" show -json tfplan > /tmp/plan.json
            deletes=$(node .github/scripts/tf-summary.mjs deletes /tmp/plan.json 2>/tmp/deletes.txt)
            rm /tmp/plan.json
            { echo "### \`$stack\`"; echo '```'; terraform -chdir="infra/$stack" show -no-color tfplan; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
            if [ "$deletes" -gt 0 ] && [ "$CONFIRM" != apply-destroys ]; then
              { echo "**Stopped: this plan deletes or replaces $deletes resources:**"; sed 's/^/- `/; s/$/`/' /tmp/deletes.txt; } >> "$GITHUB_STEP_SUMMARY"
              echo "::error::$stack deletes or replaces $deletes resources. Apply with workflow_dispatch stack=$stack confirm=apply-destroys on ${GITHUB_REF_NAME}."
              exit 1
            fi
            terraform -chdir="infra/$stack" apply tfplan
          done

  drift:
    if: github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.stack == 'drift')
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      id-token: write
      contents: read
      issues: write
    concurrency:
      group: terraform-drift
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { ref: main, path: main }
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { ref: stage, path: stage }
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { ref: dev, path: dev }
      - uses: hashicorp/setup-terraform@dfe3c3f87815947d99a8997f908cb6525fc44e9e # v4.0.1
        with:
          terraform_version: 1.15.1
          terraform_wrapper: false
      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: ${{ env.TF_PLUGIN_CACHE_DIR }}
          key: tf-plugins-${{ hashFiles('main/infra/**/.terraform.lock.hcl') }}
      - uses: aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd # v6.3.0
        with:
          role-to-assume: ${{ env.ROLE_PREFIX }}-plan
          aws-region: us-east-1
      - name: Plan every stack from the branch that applies it
        run: |
          mkdir -p "$TF_PLUGIN_CACHE_DIR" plans
          drift=0
          for pair in main:shared stage:envs/stage dev:envs/dev main:envs/main; do
            branch=${pair%%:*}; stack=${pair#*:}; name=${stack//\//-}
            echo "::group::$stack ($branch)"
            terraform -chdir="$branch/infra/$stack" init -lockfile=readonly
            set +e
            terraform -chdir="$branch/infra/$stack" plan -lock=false -detailed-exitcode -out=tfplan
            rc=$?
            set -e
            echo "::endgroup::"
            [ $rc -eq 1 ] && { echo "::error::plan failed for $stack"; exit 1; }
            [ $rc -eq 2 ] && drift=1
            terraform -chdir="$branch/infra/$stack" show -json tfplan > "plans/$name.json"
            terraform -chdir="$branch/infra/$stack" show -no-color tfplan > "plans/$name.txt"
          done
          echo "drift=$drift" >> "$GITHUB_ENV"
      - name: File or close the drift issue
        env:
          GH_TOKEN: ${{ github.token }}
          RUN: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          node dev/.github/scripts/tf-summary.mjs comment plans "Drift check — $RUN" > drift.md
          issue=$(gh issue list --repo "$GITHUB_REPOSITORY" --label drift --state open --json number --jq '.[0].number // empty')
          if [ "$drift" = 1 ]; then
            if [ -n "$issue" ]; then gh issue comment "$issue" --repo "$GITHUB_REPOSITORY" --body-file drift.md
            else gh issue create --repo "$GITHUB_REPOSITORY" --title "chore(infra): drift detected" --label drift --label "area: infra" --body-file drift.md; fi
          elif [ -n "$issue" ]; then
            gh issue close "$issue" --repo "$GITHUB_REPOSITORY" --comment "No drift as of $RUN."
          fi
```

- [ ] **Step 2: Lint the YAML**

```bash
cd /e/Personal/looper
node -e 'const y=require("fs").readFileSync(".github/workflows/terraform.yml","utf8"); if(/\t/.test(y)) throw "tab"; console.log("ok")'
gh api repos/DataCrusade1999/supreme-enigma/contents/.github/workflows/deploy.yml --jq .name >/dev/null && echo gh-ok
```
Expected: `ok`, `gh-ok`. If `actionlint` is available (`$SP/actionlint.exe`, release v1.7.x Windows zip), run it on the file and fix every finding.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/terraform.yml
git commit -m "feat(ci): run Terraform plans on PRs and applies on push

Refs #339

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 6: Docs

**Files:**
- Modify: `CLAUDE.md`, `.claude/skills/merging-a-pr/SKILL.md`, `.claude/rules/infra.md`, `docs/runbooks/infra-apply-teardown.md`, `CHANGELOG.md`

- [ ] **Step 1: Edits**

| Doc | Change |
|---|---|
| `CLAUDE.md` Merging bullet "For any PR touching `infra/`, run `terraform plan` in all four stacks …" | → "For any PR touching `infra/`, read the plan the `Terraform` workflow posted on the PR: each stack must say `No changes` or exactly the intended diff, with no `⚠ destroys or replaces` line you did not intend. A local plan is the fallback when the workflow cannot run." |
| `CLAUDE.md` Commands, Terraform line | Add: "CI plans every infra PR and applies on push (`.github/workflows/terraform.yml`); local runs are the break-glass path." |
| `.claude/skills/merging-a-pr/SKILL.md` | The "A green `test` says nothing about `infra/`" qualifier: replace with the PR-comment rule above, and add `Terraform / plan` to the step 1 list of jobs that must be green on an infra PR. In step 3 of the Dependabot section, drop the local `terraform plan` from the gate (the batch PR's own `Terraform` run covers it). |
| `.claude/rules/infra.md` | New bullet "**Terraform runs in CI**": the three roles and what each may write; `-lock=false` on plans; the destroy guard and `workflow_dispatch stack=<stack> confirm=apply-destroys` (from the branch that owns the stack); the drift issue; secrets/variables names; fork-PR setting must stay off; the two nonprod gaps; nonprod cannot delete its bucket or function; break-glass is a local apply. Rewrite the "Green CI jobs say nothing about `infra/`" bullet: CI now plans, lints and scans every infra PR. |
| `docs/runbooks/infra-apply-teardown.md` | "Plan before every merge" → the PR comment; "Apply" → merging applies; local apply is break-glass; kill switch stays local. |

- [ ] **Step 2: CHANGELOG** — under `## [Unreleased]`, `### Added` (create the subsection if missing, *within* `[Unreleased]`):

```markdown
- Terraform runs in CI (#339). Every PR that touches `infra/` gets `fmt`, `validate`, `tflint` and a Trivy scan of its plan, with the plans posted on the PR; merging into `dev`, `stage` or `main` applies that branch's stacks. A plan that would delete or replace anything stops until applied by hand with a confirmed manual run, and a weekly plan files drift as an issue. Three OIDC roles, no keys; the dev and stage apply role cannot change production's AWS resources or state.
```

- [ ] **Step 3: Commit**

```bash
git add -A CLAUDE.md .claude CHANGELOG.md docs/runbooks
git commit -m "docs(infra): describe Terraform in CI

Refs #339

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 7: PR, first CI run, rollout proofs

**Files:** possibly any from Tasks 1-6 if a run fails.

- [ ] **Step 0: Dependabot.** The `plan` job skips Dependabot's own PRs (no secrets, no OIDC token there); the batch PR the `merging-a-pr` skill prescribes is opened by the owner and gets planned. Task 6's `merging-a-pr` edit says so.

- [ ] **Step 1: Open the PR** into `dev` with `Closes #339`. Its body lists Task 3's apply and simulator results.

- [ ] **Step 2: First run.** The `Terraform / plan` job must be green: lint clean, `shared` and `envs/dev` both `No changes`, Trivy clean, one PR comment with the marker. Read the job log for `init` lock-file errors (Review Focus 1). A failure is fixed on the branch and re-run; a Trivy finding on a plan is triaged like any finding (fix, or a `.trivyignore` entry with a reason and date, matching the file's existing style).

- [ ] **Step 3: Merge** per the `merging-a-pr` skill. The `dev` push runs `apply` for `envs/dev`: expected summary `envs/dev — No changes`.

- [ ] **Step 4: Prove the apply path and the branch check** (Review Focus 3)
  - Branch from `dev`; in `infra/modules/environment/main.tf` append ` (Terraform CI test)` to the alarm's `alarm_description`. PR into `dev`: the comment shows `envs/dev — 0 to add, 1 to change, 0 to destroy`, no `⚠`. Merge: the push applies it. `aws cloudwatch describe-alarms --alarm-names bgm-looper-processor-dev-invocation-rate --query 'MetricAlarms[0].AlarmDescription' --profile personal --region us-east-1` shows the suffix.
  - `gh workflow run terraform.yml --ref dev -f stack=envs/main`: the run fails at `Resolve stacks` with `envs/main is not applied from dev`.
  - Leave the suffix in place for now; Step 5 removes it.

- [ ] **Step 5: Prove the guard** (Review Focus 2)
  - Branch from `dev`; change the module's `alarm_name` to `"${local.lambda_function_name}-invocation-rate-ci-test"` and remove the description suffix. PR: the comment shows `⚠ destroys or replaces: module.environment.aws_cloudwatch_metric_alarm.lambda_invocation_rate`. Merge: the `apply` job fails with `deletes or replaces 1 resources`.
  - `gh workflow run terraform.yml --ref dev -f stack=envs/dev -f confirm=apply-destroys`: it applies (1 added, 0 changed, 1 destroyed).
  - Revert PR restoring `alarm_name`: same guard stop, same dispatch, alarm back under its original name. `envs/dev` plans `No changes` locally afterwards.

- [ ] **Step 6: Prove drift**
  - `gh workflow run terraform.yml --ref dev -f stack=drift`: green, no issue opened (no open `drift` issue exists).
  - `aws cloudwatch put-metric-alarm` is too broad to hand-edit; instead `aws lambda update-function-configuration --function-name bgm-looper-processor-dev --description "drift test" --profile personal --region us-east-1`. Run drift again: an issue labelled `drift` opens listing `envs/dev`. `aws lambda update-function-configuration --function-name bgm-looper-processor-dev --description "" …`, run drift again: the issue closes.

- [ ] **Step 7: Promote** `dev → stage → main` per the `merging-a-pr` skill. Each promotion PR gets a `Terraform` plan comment; the `stage` push applies `envs/stage` with no changes; the `main` push applies `shared` and `envs/main` with no changes. Handle the changelog sync PR as usual.
