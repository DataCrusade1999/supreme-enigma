locals {
  lambda_function_name = "${var.project_name}-processor"
  lambda_function_arn  = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.lambda_function_name}"
}

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

resource "aws_lambda_function" "looper" {
  function_name = local.lambda_function_name
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.looper.repository_url}:latest"
  timeout       = 60
  memory_size   = 1024

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.lambda_s3]

  lifecycle {
    ignore_changes = [image_uri]
  }
}

# dev/stage twins of the function above, sharing the same exec role. Each branch's CI run
# updates its own function's image code — see .github/workflows/deploy.yml.
resource "aws_lambda_function" "looper_env" {
  for_each      = toset(["dev", "stage"])
  function_name = "${local.lambda_function_name}-${each.key}"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.looper.repository_url}:latest"
  timeout       = 60
  memory_size   = 1024

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.lambda_s3]

  lifecycle {
    ignore_changes = [image_uri]
  }
}
