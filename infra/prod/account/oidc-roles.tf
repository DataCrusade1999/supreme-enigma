# --- IAM: each Lambda's exec role is per environment, in infra/modules/environment. The
#     Vercel runtime and CI deploy identities are federated roles, further down beside
#     their OIDC providers — there are no IAM users and no long-lived access keys in
#     this project ---

locals {
  # Production's resume, in main's bucket. Dev and stage keep theirs in their own
  # accounts' buckets (nonprod-accounts spec §3).
  resume_bucket_arn = "arn:aws:s3:::${local.data_bucket_names["main"]}"
}

# --- GitHub Actions OIDC: how deploy.yml authenticates to AWS. It replaced an IAM user
#     with a permanent access key pair (#155); the user and its key were deleted once a
#     real deploy had run on all three branches through this role. ---

# No thumbprint_list: AWS validates token.actions.githubusercontent.com against its own
# trusted-root CA library, so pinning a leaf thumbprint here only creates something that
# breaks when GitHub rotates its certificate.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "ci_deploy" {
  name = "${var.project_name}-ci-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Condition = {
        # StringEquals on main's ref, NOT StringLike with a wildcard. A wildcard
        # `sub` would also match a pull_request context, which is what a fork PR
        # runs as — that is the documented way this trust policy gets abused.
        # deploy.yml declares no `environment:`, so the ref: form is the sub GitHub
        # actually issues. Dev and stage deploy through their own accounts' roles.
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = [
            "${local.github_sub_prefix}:ref:refs/heads/main",
          ]
        }
      }
    }]
  })
}

# Carried over verbatim from the deleted ci-deploy user's inline policy — the migration
# moved the identity, not the permissions.
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
        Resource = local.all_lambda_function_arns
      }
    ]
  })
}

# --- Vercel OIDC: how the app reaches S3 and Lambda at runtime, via awsCredentials() in
#     web/lib/aws.ts reading APP_AWS_ROLE_ARN. It replaced an IAM user with a permanent
#     access key pair (#155); the user and its key were deleted once production, stage
#     and dev had each been exercised end to end through this role. ---

resource "aws_iam_openid_connect_provider" "vercel" {
  # Team issuer mode, set on vercel_project.looper below — the issuer carries the
  # account slug, so the global-mode URL (no slug) would not match the iss claim.
  url            = "https://oidc.vercel.com/${local.vercel_team_slug}"
  client_id_list = ["https://vercel.com/${local.vercel_team_slug}"]
}

resource "aws_iam_role" "vercel" {
  name = "${var.project_name}-vercel"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.vercel.arn }
      Condition = {
        StringEquals = {
          "oidc.vercel.com/${local.vercel_team_slug}:aud" = "https://vercel.com/${local.vercel_team_slug}"
          # Production only. Preview deployments assume bgm-looper-vercel-preview in
          # their own account.
          "oidc.vercel.com/${local.vercel_team_slug}:sub" = "owner:${local.vercel_team_slug}:project:${var.project_name}:environment:production"
        }
      }
    }]
  })
}

# Carried over from the deleted vercel-sa user's inline policy — the migration moved the
# identity, not the permissions. ResumeHeadObjectNotFound in particular is load-bearing;
# its comment explains why. The s3:DeleteObject grant that came across with it is gone:
# nothing under web/ issues a DeleteObjectCommand, and deleting drafts is the job of the
# resume/drafts/ lifecycle rule in infra/modules/environment, not the app's.
resource "aws_iam_role_policy" "vercel_resume" {
  name = "${var.project_name}-vercel-resume"
  role = aws_iam_role.vercel.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ResumeObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${local.resume_bucket_arn}/resume/*"]
      },
      {
        # HeadObject on a key that does not exist returns 403, not 404, unless the
        # caller holds s3:ListBucket on the bucket — so without this the app's
        # objectExists() rethrows on every absent key and the first extraction and
        # the first publish both 500. Deliberately unconditioned: S3 evaluates this
        # for its 404-vs-403 decision with no s3:prefix in context, so an
        # s3:prefix-scoped grant does not restore the 404. Bucket ARN only, so this
        # grants listing key names in main's bucket and nothing else — GetObject
        # stays scoped to uploads/, outputs/ and resume/ above.
        Sid      = "ResumeHeadObjectNotFound"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [local.resume_bucket_arn]
      },
    ]
  })
}
