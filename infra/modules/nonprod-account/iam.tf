# OIDC providers and the four federated roles in this account. There are no IAM users
# and no long-lived access keys (.claude/rules/infra.md). Every trust policy uses
# StringEquals on explicit subjects, never a wildcard: a wildcard `sub` would also
# match a pull_request context, which is what a fork PR runs as. Nothing here trusts
# another account; the aws-org repo's Access Analyzer archive rules cover exactly
# these four role names, so a new role trusting these providers raises a finding.

# No thumbprint_list: AWS validates token.actions.githubusercontent.com against its own
# trusted-root CA library, so pinning a leaf thumbprint here only creates something that
# breaks when GitHub rotates its certificate.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_openid_connect_provider" "vercel" {
  # Team issuer mode, set on vercel_project.looper in infra/prod/account — the issuer carries
  # the account slug, so the global-mode URL (no slug) would not match the iss claim.
  url            = "https://oidc.vercel.com/${var.vercel_team_slug}"
  client_id_list = ["https://vercel.com/${var.vercel_team_slug}"]
}

# --- Terraform in CI (.github/workflows/terraform.yml), assumed through the role
#     .github/scripts/tf-stacks.sh names for this account's stacks. ---

data "aws_iam_policy_document" "tf_trust" {
  for_each = {
    # PRs and the weekly drift run, which runs from dev for every stack — so dev's ref,
    # not this environment's, in stage too.
    plan = ["${var.github_sub_prefix}:pull_request", "${var.github_sub_prefix}:ref:refs/heads/dev"]
    # Only this environment's branch applies its stacks.
    apply = ["${var.github_sub_prefix}:ref:refs/heads/${var.env}"]
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

# This environment's stacks on pushes to its branch. AdministratorAccess, unlike prod's
# name-scoped apply roles: the account is the blast radius (spec §3). It holds only this
# environment, trusts nothing outside itself, and the organization's deny-IAM-users SCP
# still applies. The workflow's destroy guard (confirm `apply-destroys`) still stops a
# plan that deletes or replaces anything. A narrower policy would only be a list to keep
# in step with every new resource, guarding nothing the account boundary doesn't.
resource "aws_iam_role" "tf_apply" {
  name               = "${var.project_name}-tf-apply"
  assume_role_policy = data.aws_iam_policy_document.tf_trust["apply"].json
}

resource "aws_iam_role_policy_attachment" "tf_apply_admin" {
  role       = aws_iam_role.tf_apply.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# --- Image deploy: deploy.yml's `deploy` job on pushes to this environment's branch. ---

resource "aws_iam_role" "ci_deploy" {
  name = "${var.project_name}-ci-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Condition = {
        # This environment's branch only. deploy.yml declares no `environment:`, so the
        # ref: form is the sub GitHub actually issues.
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = ["${var.github_sub_prefix}:ref:refs/heads/${var.env}"]
        }
      }
    }]
  })
}

# The same shape as production's ci_deploy policy in infra/prod/account, scoped to this
# account's repo and this environment's function.
resource "aws_iam_role_policy" "ci_deploy" {
  name = "${var.project_name}-ci-deploy-policy"
  role = aws_iam_role.ci_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:BatchGetImage",
          "ecr:DescribeImages",
        ]
        Resource = aws_ecr_repository.looper.arn
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:UpdateFunctionCode", "lambda:GetFunction"]
        Resource = local.lambda_function_arn
      }
    ]
  })
}

# --- Vercel runtime: preview deployments of this environment's branch, via
#     awsCredentials() in web/lib/aws.ts reading APP_AWS_ROLE_ARN. ---

# Vercel's subject has only production and preview, so dev's and stage's roles both
# trust the preview subject; they are kept apart only by which role ARN each branch's
# APP_AWS_ROLE_ARN names (per-env IAM spec §6, accepted in the nonprod-accounts spec §2).
# Its bucket, resume, News Desk and Lambda grants belong to the app stack beside this
# one, which looks the role up by name: keep the name.
resource "aws_iam_role" "vercel_preview" {
  name = "${var.project_name}-vercel-preview"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.vercel.arn }
      Condition = {
        StringEquals = {
          "oidc.vercel.com/${var.vercel_team_slug}:aud" = "https://vercel.com/${var.vercel_team_slug}"
          "oidc.vercel.com/${var.vercel_team_slug}:sub" = "owner:${var.vercel_team_slug}:project:${var.project_name}:environment:preview"
        }
      }
    }]
  })
}

# Verified Permissions decides every gated request from the Cedar files under
# infra/modules/auth/cedar/; this lets the app ask this account's store, and lets the
# Access page read and write grants and manage the pool's users and groups.
resource "aws_iam_role_policy" "vercel_preview_access" {
  name = "${var.project_name}-vercel-preview-access"
  role = aws_iam_role.vercel_preview.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AuthorizeRequests"
        Effect   = "Allow"
        Action   = ["verifiedpermissions:IsAuthorizedWithToken"]
        Resource = [module.auth.policy_store_arn]
      },
      {
        Sid      = "AccessGrants"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"]
        Resource = [module.auth.access_grants_table_arn]
      },
      {
        Sid    = "ManageAccess"
        Effect = "Allow"
        Action = [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminUserGlobalSignOut",
          "cognito-idp:AdminDeleteUser",
        ]
        Resource = [module.auth.user_pool_arn]
      },
    ]
  })
}
