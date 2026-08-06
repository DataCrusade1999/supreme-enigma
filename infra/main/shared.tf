# Resources that exist once and are used by all three environments (main/dev/stage) —
# the ECR repo, IAM (exec role + service-account users), the Vercel project itself, and
# the app secrets/config that don't vary by branch. Per-branch resources (Lambda functions,
# S3 buckets, and the env vars that point at them) live in environments.tf instead.

locals {
  lambda_function_name = "${var.project_name}-processor"
  lambda_function_arn  = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.lambda_function_name}"

  all_lambda_function_arns = concat(
    [local.lambda_function_arn],
    [for f in aws_lambda_function.looper_env : f.arn]
  )
  all_audio_bucket_arns = concat(
    [aws_s3_bucket.audio.arn],
    [for b in aws_s3_bucket.audio_env : b.arn]
  )
}

# --- ECR (one repo, per-branch tag prefixes — see environments.tf's Lambda functions
#     and .github/workflows/deploy.yml for how each branch tags/deploys its own image) ---

resource "aws_ecr_repository" "looper" {
  name                 = "${var.project_name}-lambda"
  force_delete         = true
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "looper" {
  repository = aws_ecr_repository.looper.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the 1 most recent main image"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["main"]
          countType     = "imageCountMoreThan"
          countNumber   = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 3
        description  = "Keep only the 1 most recent dev image"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["dev"]
          countType     = "imageCountMoreThan"
          countNumber   = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 4
        description  = "Keep only the 1 most recent stage image"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["stage"]
          countType     = "imageCountMoreThan"
          countNumber   = 1
        }
        action = { type = "expire" }
      }
    ]
  })
}

# --- IAM: one Lambda exec role shared by all three functions, and the two service-account
#     users (Vercel's runtime creds, CI's deploy creds) — both scoped to all three envs'
#     resources via the all_lambda_function_arns / all_audio_bucket_arns locals above ---

resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_s3" {
  name = "${var.project_name}-lambda-s3"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject"]
      Resource = concat(
        ["${aws_s3_bucket.audio.arn}/*"],
        [for b in aws_s3_bucket.audio_env : "${b.arn}/*"]
      )
    }]
  })
}

resource "aws_iam_user" "vercel" {
  name = "${var.project_name}-vercel-sa"
}

resource "aws_iam_access_key" "vercel" {
  user = aws_iam_user.vercel.name
}

resource "aws_iam_user_policy" "vercel" {
  name = "${var.project_name}-vercel-policy"
  user = aws_iam_user.vercel.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = [for arn in local.all_audio_bucket_arns : "${arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = local.all_lambda_function_arns
      }
    ]
  })
}

resource "aws_iam_user" "ci_deploy" {
  name = "${var.project_name}-ci-deploy"
}

resource "aws_iam_access_key" "ci_deploy" {
  user = aws_iam_user.ci_deploy.name
}

resource "aws_iam_user_policy" "ci_deploy" {
  name = "${var.project_name}-ci-deploy-policy"
  user = aws_iam_user.ci_deploy.name

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

# --- Vercel project + the config/secrets that are identical across production and preview ---

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
