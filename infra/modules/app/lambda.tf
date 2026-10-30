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

resource "aws_iam_role_policy" "lambda_s3" {
  name = "${var.project_name}-lambda-s3-${var.env}"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = ["${aws_s3_bucket.data.arn}/*"]
    }]
  })
}

resource "aws_lambda_function" "this" {
  function_name = local.lambda_function_name
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${data.aws_ecr_repository.looper.repository_url}:${var.bootstrap_image_tag}"
  timeout       = 60
  memory_size   = 1024

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.lambda_s3]

  lifecycle {
    ignore_changes = [image_uri]
  }
}
