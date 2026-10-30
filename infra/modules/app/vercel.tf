# The Vercel role this environment's deployments assume. Vercel's OIDC subject has
# only production and preview, so dev and stage share the preview role — see the
# per-env IAM spec §6. Keyed on var.env, which is validated, rather than on
# vercel_target, so a mistyped target cannot attach this policy to the wrong role.
locals {
  vercel_role_name = {
    main  = "${var.project_name}-vercel"
    dev   = "${var.project_name}-vercel-preview"
    stage = "${var.project_name}-vercel-preview"
  }
}

data "aws_iam_role" "vercel" {
  name = local.vercel_role_name[var.env]
}

data "vercel_project" "looper" {
  name = var.project_name
}

# --- Vercel env vars: production target -> main, bare preview -> dev,
#     preview + git_branch "stage" -> stage. ---

resource "vercel_project_environment_variable" "s3_bucket" {
  project_id = data.vercel_project.looper.id
  key        = "S3_BUCKET_NAME"
  value      = aws_s3_bucket.data.bucket
  target     = var.vercel_target
  git_branch = var.vercel_git_branch
  sensitive  = false
}

resource "vercel_project_environment_variable" "lambda_function_name" {
  project_id = data.vercel_project.looper.id
  key        = "LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.this.function_name
  target     = var.vercel_target
  git_branch = var.vercel_git_branch
  sensitive  = false
}

# --- What this environment's deployments may do, on the Vercel role for its target.
#     The resume grants are not here: the resume lives in main's bucket and every
#     environment uses it, so they stay in infra/prod/account/oidc-roles.tf. ---

resource "aws_iam_role_policy" "vercel" {
  name = "${var.project_name}-vercel-${var.env}"
  role = data.aws_iam_role.vercel.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AudioScratchObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${aws_s3_bucket.data.arn}/uploads/*", "${aws_s3_bucket.data.arn}/outputs/*"]
      },
      {
        Sid      = "NewsDeskObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${aws_s3_bucket.data.arn}/news-desk/*"]
      },
      {
        # Same reason as ResumeHeadObjectNotFound in infra/prod/account/oidc-roles.tf: without
        # ListBucket, S3 answers a GetObject for a missing key with 403, not 404. The
        # News Desk's first page load reads a snapshot that does not exist yet, and
        # would report that as a permissions failure. Grants listing key names in this
        # environment's bucket.
        Sid      = "NewsDeskMissingSnapshotIs404"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.data.arn]
      },
      {
        Sid      = "InvokeProcessor"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = [aws_lambda_function.this.arn]
      }
    ]
  })
}
