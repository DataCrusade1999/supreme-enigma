locals {
  all_lambda_function_arns = concat(
    [local.lambda_function_arn],
    [for f in aws_lambda_function.looper_env : f.arn]
  )
  all_audio_bucket_arns = concat(
    [aws_s3_bucket.audio.arn],
    [for b in aws_s3_bucket.audio_env : b.arn]
  )
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
