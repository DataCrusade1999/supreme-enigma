# OIDC providers and the four federated roles in this account: the CI deploy and Vercel
# preview roles here, the Terraform plan and apply roles in terraform-ci-roles.tf. There
# are no IAM users and no long-lived access keys (.claude/rules/infra.md). Every trust
# policy uses StringEquals on explicit subjects, never a wildcard: a wildcard `sub`
# would also match a pull_request context, which is what a fork PR runs as. Nothing
# here trusts another account; the aws-org repo's Access Analyzer archive rules cover
# exactly these four role names, so a new role trusting these providers raises a finding.

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
