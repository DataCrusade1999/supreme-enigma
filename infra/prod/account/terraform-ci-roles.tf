# Terraform in CI (#339): a read-only plan role and an apply role, assumed by
# .github/workflows/terraform.yml through the GitHub OIDC provider in oidc-roles.tf. Dev's
# and stage's stacks use their own accounts' roles (infra/modules/nonprod-account). Every
# trust policy uses StringEquals on explicit subjects, never a wildcard — see the
# ci_deploy role's comment for why. The workstation's `personal` credentials stay the
# break-glass path if CI ever locks itself out.

locals {
  tf_state_bucket_arn = "arn:aws:s3:::bgm-looper-tf-state-${data.aws_caller_identity.current.account_id}"
  account_id          = data.aws_caller_identity.current.account_id

  # Bucket configuration only, never objects: Terraform manages no object, and `s3:*`
  # trips Trivy's AWS-0345 in deploy.yml's test job. Removing CORS, lifecycle or the public access
  # block is a Put of the same name, so these cover deletes too.
  tf_bucket_actions = [
    "s3:CreateBucket", "s3:PutBucket*", "s3:DeleteBucket*",
    "s3:PutLifecycleConfiguration", "s3:PutEncryptionConfiguration",
  ]

  # The account's CloudTrail trail and its log bucket (#375), in old-cloudtrail-bucket.tf.
  audit_trail_name  = "${var.project_name}-audit"
  audit_bucket_name = "${var.project_name}-cloudtrail-${data.aws_caller_identity.current.account_id}"
}

data "aws_iam_policy_document" "tf_trust" {
  for_each = {
    plan = ["${local.github_sub_prefix}:pull_request", "${local.github_sub_prefix}:ref:refs/heads/dev"]
    # dev applies `prod/account` (#345); main applies `prod/app`.
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

# ReadOnlyAccess has no verifiedpermissions:ListTagsForResource, which the provider
# calls on every refresh of the policy store (#359).
data "aws_iam_policy_document" "tf_plan" {
  statement {
    sid       = "VerifiedPermissionsReads"
    actions   = ["verifiedpermissions:Get*", "verifiedpermissions:List*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "tf_plan" {
  name   = "${var.project_name}-tf-plan"
  role   = aws_iam_role.tf_plan.id
  policy = data.aws_iam_policy_document.tf_plan.json
}

# `prod/account` on pushes to dev and `prod/app` on pushes to main (#345), plus manual runs
# of either. Trusting dev means code merged to dev changes production's prod/account
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
    resources = ["arn:aws:s3:::${local.data_bucket_names["main"]}", "arn:aws:s3:::${local.audit_bucket_name}"]
  }
  statement {
    sid       = "AuditTrail"
    actions   = ["cloudtrail:*"]
    resources = ["arn:aws:cloudtrail:${var.aws_region}:${local.account_id}:trail/${local.audit_trail_name}"]
  }
  statement {
    # CreateDetector takes no resource ARN; the detector's ID only exists afterwards (#376).
    # Reads come from ReadOnlyAccess. Every other ARN-less GuardDuty action (members,
    # organization admin, IP and threat-intel sets) stays out.
    sid       = "GuardDutyCreate"
    actions   = ["guardduty:CreateDetector"]
    resources = ["*"]
  }
  statement {
    sid       = "GuardDutyDetector"
    actions   = ["guardduty:*"]
    resources = ["arn:aws:guardduty:${var.aws_region}:${local.account_id}:detector/*"]
  }
  statement {
    # Creating the first detector creates GuardDuty's service-linked role.
    sid       = "GuardDutyServiceLinkedRole"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["arn:aws:iam::${local.account_id}:role/aws-service-role/guardduty.amazonaws.com/*"]
    condition {
      test     = "StringEquals"
      variable = "iam:AWSServiceName"
      values   = ["guardduty.amazonaws.com"]
    }
  }
  statement {
    # Alert rules that publish to the alerts topic (#376, #378).
    sid       = "EventRules"
    actions   = ["events:*"]
    resources = ["arn:aws:events:${var.aws_region}:${local.account_id}:rule/${var.project_name}-*"]
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
