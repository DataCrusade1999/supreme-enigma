# --- Lambda ---
# Each branch's CI run updates its own function's image code — see .github/workflows/deploy.yml.

data "aws_ecr_repository" "looper" {
  name = "${var.project_name}-lambda"
}

# One exec role per environment, so each function can reach only its own bucket.
# The app passes this environment's S3_BUCKET_NAME in every invoke payload.
resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec-${var.env}"

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

# The handler reads only uploads/ and writes only outputs/ (lambda/src/looper/handler.py
# refuses any other key). Scoping the grant the same way keeps a compromised handler
# away from resume and News Desk objects in the same bucket (#170).
resource "aws_iam_role_policy" "lambda_s3" {
  name = "${var.project_name}-lambda-s3-${var.env}"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadUploads"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${aws_s3_bucket.data.arn}/uploads/*"]
      },
      {
        Sid      = "WriteOutputs"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = ["${aws_s3_bucket.data.arn}/outputs/*"]
      },
    ]
  })
}

# Lambda creates this group itself with no expiry when it first logs. Managed here so
# logs age out; each app stack's root imports the group that already exists (#450).
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.lambda_function_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "this" {
  function_name = local.lambda_function_name
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${data.aws_ecr_repository.looper.repository_url}:${var.bootstrap_image_tag}"
  timeout       = 60
  memory_size   = 1024

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic,
    aws_iam_role_policy.lambda_s3,
    aws_cloudwatch_log_group.lambda,
  ]

  lifecycle {
    ignore_changes = [image_uri]
  }
}
