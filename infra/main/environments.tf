# Everything that exists once per branch: each environment's S3 bucket, Lambda function,
# and the Vercel env vars that point the app at its own bucket/function. Resources shared
# across all three branches (ECR, IAM, the Vercel project itself) live in shared.tf instead.
#
# main's bucket/function are the original resources, kept unrenamed to avoid a destructive
# replacement — dev/stage are for_each twins (identical shape, different name/branch).

# --- S3 ---

resource "aws_s3_bucket" "audio" {
  bucket = "${var.project_name}-audio-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket                  = aws_s3_bucket.audio.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    id     = "expire-1-day"
    status = "Enabled"
    filter {}
    expiration {
      days = 1
    }
  }
}

resource "aws_s3_bucket" "audio_env" {
  for_each = toset(["dev", "stage"])
  bucket   = "${var.project_name}-audio-${each.key}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "audio_env" {
  for_each                = aws_s3_bucket.audio_env
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "audio_env" {
  for_each = aws_s3_bucket.audio_env
  bucket   = each.value.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audio_env" {
  for_each = aws_s3_bucket.audio_env
  bucket   = each.value.id

  rule {
    id     = "expire-1-day"
    status = "Enabled"
    filter {}
    expiration {
      days = 1
    }
  }
}

# --- Lambda ---
# Each branch's CI run updates its own function's image code — see .github/workflows/deploy.yml.

resource "aws_lambda_function" "looper" {
  function_name = local.lambda_function_name
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.looper.repository_url}@${data.aws_ecr_image.bootstrap.image_digest}"
  timeout       = 60
  memory_size   = 1024

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.lambda_s3]

  lifecycle {
    ignore_changes = [image_uri]
  }
}

resource "aws_lambda_function" "looper_env" {
  for_each      = toset(["dev", "stage"])
  function_name = "${local.lambda_function_name}-${each.key}"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.looper.repository_url}@${data.aws_ecr_image.bootstrap.image_digest}"
  timeout       = 60
  memory_size   = 1024

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.lambda_s3]

  lifecycle {
    ignore_changes = [image_uri]
  }
}

# --- Vercel env vars: S3_BUCKET_NAME / LAMBDA_FUNCTION_NAME need a different value per
#     environment, resolved via git_branch-scoped overrides: production target -> main's
#     resources, bare preview target (the default for any branch) -> dev's resources,
#     git_branch = "stage" override -> stage's resources. ---

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
