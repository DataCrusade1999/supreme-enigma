# Terraform in CI (#339): one read-only plan role and two apply roles, assumed by
# .github/workflows/terraform.yml through the GitHub OIDC provider in shared.tf. Every
# trust policy uses StringEquals on explicit subjects, never a wildcard — see the
# ci_deploy role's comment for why. The workstation's `personal` credentials stay the
# break-glass path if CI ever locks itself out.

locals {
  tf_state_bucket_arn = "arn:aws:s3:::bgm-looper-tf-state-${data.aws_caller_identity.current.account_id}"
  account_id          = data.aws_caller_identity.current.account_id

  nonprod_envs = ["dev", "stage"]

  # Bucket configuration only, never objects: Terraform manages no object, and `s3:*`
  # trips Trivy's AWS-0345 in deploy.yml's test job. Removing CORS, lifecycle or the public access
  # block is a Put of the same name, so these cover deletes too.
  tf_bucket_actions = [
    "s3:CreateBucket", "s3:PutBucket*", "s3:DeleteBucket*",
    "s3:PutLifecycleConfiguration", "s3:PutEncryptionConfiguration",
  ]
}

data "aws_iam_policy_document" "tf_trust" {
  for_each = {
    plan    = ["${local.github_sub_prefix}:pull_request", "${local.github_sub_prefix}:ref:refs/heads/dev"]
    nonprod = ["${local.github_sub_prefix}:ref:refs/heads/dev", "${local.github_sub_prefix}:ref:refs/heads/stage"]
    # dev applies `shared` (#345); main applies `envs/main`.
    prod = ["${local.github_sub_prefix}:ref:refs/heads/dev", "${local.github_sub_prefix}:ref:refs/heads/main"]
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

# envs/dev and envs/stage on pushes to dev and stage. Writes are limited by name to
# dev's and stage's resources and state (`shared` on a dev push uses the prod role). Two
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
    sid       = "Buckets"
    actions   = local.tf_bucket_actions
    resources = [for e in local.nonprod_envs : "arn:aws:s3:::${local.data_bucket_names[e]}"]
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
    sid     = "Alarms"
    actions = ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:TagResource", "cloudwatch:UntagResource"]
    # `-*`, not the exact name, so a rename (the guard test in the rollout) can create
    # the new alarm. Still disjoint: main's alarm is `bgm-looper-processor-invocation-rate`.
    resources = [for e in local.nonprod_envs : "arn:aws:cloudwatch:${var.aws_region}:${local.account_id}:alarm:${local.lambda_function_names[e]}-*"]
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

# `shared` on pushes to dev and `envs/main` on pushes to main (#345), plus manual runs
# of either. Trusting dev means code merged to dev changes production's shared
# resources — the owner's call, so a shared change and the env change that depends on
# it land in one merge. Every service the stacks manage, with IAM limited to this
# project's names. It can edit its own role — inherent to letting CI manage the roles;
# a local apply is the way back.
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
      "lambda:*", "cloudwatch:*", "sns:*", "budgets:*", "ecr:*",
      "cognito-idp:*", "ses:*", "acm:*", "logs:*",
      "verifiedpermissions:*", "dynamodb:*",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "Bucket"
    actions   = local.tf_bucket_actions
    resources = ["arn:aws:s3:::${local.data_bucket_names["main"]}"]
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
