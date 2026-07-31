resource "random_password" "cookie_secret" {
  length  = 32
  special = false
}

resource "vercel_project" "looper" {
  name           = var.project_name
  framework      = "nextjs"
  root_directory = "app"

  git_repository = {
    type              = "github"
    repo              = var.github_repo
    production_branch = "main"
  }
}

locals {
  env_targets = ["production", "preview"]
}

# S3_BUCKET_NAME / LAMBDA_FUNCTION_NAME need a different value per environment, so they're
# set separately below instead of through env_targets: production -> main's resources,
# preview (default, i.e. any branch incl. dev) -> dev's resources, stage -> stage's resources
# via the git_branch override, which takes precedence over the preview default on that branch.

resource "vercel_project_environment_variable" "app_password" {
  project_id = vercel_project.looper.id
  key        = "APP_PASSWORD"
  value      = var.app_password
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "cookie_secret" {
  project_id = vercel_project.looper.id
  key        = "COOKIE_SECRET"
  value      = random_password.cookie_secret.result
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "aws_access_key" {
  project_id = vercel_project.looper.id
  key        = "AWS_ACCESS_KEY_ID"
  value      = aws_iam_access_key.vercel.id
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "aws_secret_key" {
  project_id = vercel_project.looper.id
  key        = "AWS_SECRET_ACCESS_KEY"
  value      = aws_iam_access_key.vercel.secret
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "aws_region" {
  project_id = vercel_project.looper.id
  key        = "APP_AWS_REGION"
  value      = var.aws_region
  target     = local.env_targets
}

resource "vercel_project_environment_variable" "s3_bucket_production" {
  project_id = vercel_project.looper.id
  key        = "S3_BUCKET_NAME"
  value      = aws_s3_bucket.audio.bucket
  target     = ["production"]
}

resource "vercel_project_environment_variable" "s3_bucket_preview" {
  project_id = vercel_project.looper.id
  key        = "S3_BUCKET_NAME"
  value      = aws_s3_bucket.audio_env["dev"].bucket
  target     = ["preview"]
}

resource "vercel_project_environment_variable" "s3_bucket_stage" {
  project_id = vercel_project.looper.id
  key        = "S3_BUCKET_NAME"
  value      = aws_s3_bucket.audio_env["stage"].bucket
  target     = ["preview"]
  git_branch = "stage"
}

resource "vercel_project_environment_variable" "lambda_function_name_production" {
  project_id = vercel_project.looper.id
  key        = "LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.looper.function_name
  target     = ["production"]
}

resource "vercel_project_environment_variable" "lambda_function_name_preview" {
  project_id = vercel_project.looper.id
  key        = "LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.looper_env["dev"].function_name
  target     = ["preview"]
}

resource "vercel_project_environment_variable" "lambda_function_name_stage" {
  project_id = vercel_project.looper.id
  key        = "LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.looper_env["stage"].function_name
  target     = ["preview"]
  git_branch = "stage"
}
