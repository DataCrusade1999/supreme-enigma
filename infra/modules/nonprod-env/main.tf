# One nonprod environment in its own account: modules/environment's bucket, Lambda,
# alarm and two Vercel vars, plus what infra/shared provides for the prod account's
# environments: the resume grant and the preview Vercel vars for sign-in, authorization,
# the role and the resume bucket. The account stack (infra/nonprod/<env>/account)
# creates the role, ECR repo and alerts topic that modules/environment finds by name.
module "environment" {
  source = "../environment"

  env               = var.env
  project_name      = var.project_name
  vercel_target     = ["preview"]
  vercel_git_branch = var.vercel_git_branch

  bootstrap_image_tag = var.bootstrap_image_tag
}

data "aws_iam_role" "vercel_preview" {
  name = "${var.project_name}-vercel-preview"
}

data "vercel_project" "looper" {
  name = var.project_name
}

locals {
  # modules/environment outputs the bucket's name only; an S3 bucket ARN carries no
  # account or region, so it is built from the name.
  data_bucket_arn = "arn:aws:s3:::${module.environment.data_bucket_name}"
}

# --- The resume. In the prod account all three environments share main's resume, so
#     its grants live in infra/shared. Here each account holds its own resume, in its
#     own data bucket. ---

resource "aws_iam_role_policy" "vercel_resume" {
  name = "${var.project_name}-vercel-${var.env}-resume"
  role = data.aws_iam_role.vercel_preview.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ResumeObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${local.data_bucket_arn}/resume/*"]
      },
      {
        # HeadObject on a key that does not exist returns 403, not 404, unless the
        # caller holds s3:ListBucket on the bucket — so without this the app's
        # objectExists() rethrows on every absent key and the first extraction and
        # the first publish both 500. Deliberately unconditioned: S3 evaluates this
        # for its 404-vs-403 decision with no s3:prefix in context, so an
        # s3:prefix-scoped grant does not restore the 404. Bucket ARN only, so this
        # grants listing key names in this environment's bucket and nothing else —
        # GetObject stays scoped to resume/ above and to modules/environment's prefixes.
        Sid      = "ResumeHeadObjectNotFound"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [local.data_bucket_arn]
      },
    ]
  })
}

# --- Vercel env vars for this environment's preview deployments: bare preview for
#     dev, preview + git_branch "stage" for stage. Same target/git_branch pattern as
#     modules/environment's S3_BUCKET_NAME and LAMBDA_FUNCTION_NAME. ---

# APP_AWS_ROLE_ARN, not AWS_ROLE_ARN: see the comment on the same variable in
# infra/shared/shared.tf.
resource "vercel_project_environment_variable" "aws_role_arn" {
  project_id = data.vercel_project.looper.id
  key        = "APP_AWS_ROLE_ARN"
  value      = var.vercel_role_arn
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = false
}

resource "vercel_project_environment_variable" "resume_bucket_name" {
  project_id = data.vercel_project.looper.id
  key        = "RESUME_BUCKET_NAME"
  value      = module.environment.data_bucket_name
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = false
}

resource "vercel_project_environment_variable" "avp_policy_store_id" {
  project_id = data.vercel_project.looper.id
  key        = "AVP_POLICY_STORE_ID"
  value      = var.avp_policy_store_id
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = false
}

# A literal, not an output of the account stack: this stack reads that one's applied
# state, so a new output would fail the plan until the account stack had applied.
# The table is aws_dynamodb_table.access_grants in infra/modules/auth.
resource "vercel_project_environment_variable" "access_grants_table" {
  project_id = data.vercel_project.looper.id
  key        = "ACCESS_GRANTS_TABLE"
  value      = "site-access-grants"
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = false
}

resource "vercel_project_environment_variable" "cognito_domain" {
  project_id = data.vercel_project.looper.id
  key        = "COGNITO_DOMAIN"
  value      = var.cognito_domain_url
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = false
}

resource "vercel_project_environment_variable" "cognito_client_id" {
  project_id = data.vercel_project.looper.id
  key        = "COGNITO_CLIENT_ID"
  value      = var.cognito_client_id
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = false
}

resource "vercel_project_environment_variable" "cognito_user_pool_id" {
  project_id = data.vercel_project.looper.id
  key        = "COGNITO_USER_POOL_ID"
  value      = var.cognito_user_pool_id
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = false
}
