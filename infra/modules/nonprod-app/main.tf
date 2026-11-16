# One nonprod environment in its own account: modules/app's bucket, Lambda,
# alarm and two Vercel vars, plus what infra/prod/account provides for the prod account's
# environments: the resume grant and every preview Vercel var this environment's
# branch reads (sign-in, authorization, the role, the resume bucket, the cookie
# secret, the AWS region and the OpenRouter settings). The account stack (infra/<env>/account)
# creates the role, ECR repo and alerts topic that modules/app finds by name.
module "environment" {
  source = "../app"

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
  # modules/app outputs the bucket's name only; an S3 bucket ARN carries no
  # account or region, so it is built from the name.
  data_bucket_arn = "arn:aws:s3:::${module.environment.data_bucket_name}"
}

# --- The resume. In the prod account all three environments share main's resume, so
#     its grants live in infra/prod/account. Here each account holds its own resume, in its
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
        # GetObject stays scoped to resume/ above and to modules/app's prefixes.
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
#     modules/app's S3_BUCKET_NAME and LAMBDA_FUNCTION_NAME. ---

# APP_AWS_ROLE_ARN, not AWS_ROLE_ARN: see the comment on the same variable in
# infra/prod/account/vercel-project.tf.
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

# Access emails (#530) go out from this address on the account's SES identity,
# <env>.ashutosh-pandey.com. A literal for the same reason as the table name above;
# the preview role's SendAccessEmail grant in infra/modules/nonprod-account names the
# same address. The account is in the SES sandbox, so only the owner receives them.
resource "vercel_project_environment_variable" "access_from_email" {
  project_id = data.vercel_project.looper.id
  key        = "ACCESS_FROM_EMAIL"
  value      = "access@${var.env}.ashutosh-pandey.com"
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

resource "random_password" "cookie_secret" {
  length  = 32
  special = false
}

resource "vercel_project_environment_variable" "cookie_secret" {
  project_id = data.vercel_project.looper.id
  key        = "COOKIE_SECRET"
  value      = random_password.cookie_secret.result
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = true
}

resource "vercel_project_environment_variable" "aws_region" {
  project_id = data.vercel_project.looper.id
  key        = "APP_AWS_REGION"
  value      = "us-east-1"
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = false
}

resource "vercel_project_environment_variable" "openrouter_api_key" {
  project_id = data.vercel_project.looper.id
  key        = "OPENROUTER_API_KEY"
  value      = var.openrouter_api_key
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = true
}

resource "vercel_project_environment_variable" "openrouter_model" {
  project_id = data.vercel_project.looper.id
  key        = "OPENROUTER_MODEL"
  value      = var.openrouter_model
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = false
}

resource "vercel_project_environment_variable" "openrouter_base_url" {
  project_id = data.vercel_project.looper.id
  key        = "OPENROUTER_BASE_URL"
  value      = "https://openrouter.ai/api/v1"
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = false
}

resource "vercel_project_environment_variable" "news_desk_model" {
  project_id = data.vercel_project.looper.id
  key        = "NEWS_DESK_MODEL"
  value      = var.news_desk_model
  target     = ["preview"]
  git_branch = var.vercel_git_branch
  sensitive  = false
}
