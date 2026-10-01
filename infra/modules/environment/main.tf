# Everything that exists once per branch: the branch's data bucket, Lambda function,
# its invocation alarm, and the two Vercel env vars that point the app at them.
# Shared resources (ECR, IAM, the Vercel project) live in infra/shared and are found
# here by name, so this stack never reads shared's state.

data "aws_caller_identity" "current" {}

data "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec"
}

data "aws_ecr_repository" "looper" {
  name = "${var.project_name}-lambda"
}

data "aws_sns_topic" "budget_alerts" {
  name = "${var.project_name}-budget-alerts"
}

data "vercel_project" "looper" {
  name = var.project_name
}

locals {
  # Must stay in step with local.env_suffix in infra/shared/shared.tf, which builds
  # the same names for the IAM policies and RESUME_BUCKET_NAME.
  suffix               = var.env == "main" ? "" : "-${var.env}"
  lambda_function_name = "${var.project_name}-processor${local.suffix}"

  # The three deployment origins that issue presigned-URL uploads. Wildcard origins were
  # not an authorization hole (the signature grants access, not CORS) but there is no
  # reason for any other site's JS to be able to read these responses.
  #
  # This list is exhaustive and deliberately has no wildcard: these seven origins are the
  # only places a browser upload works. A one-off feature-branch preview
  # (bgm-looper-git-<branch>-….vercel.app), a team alias, or a dev server on a port other
  # than 3000 will fail the PUT with an opaque browser CORS error — that is accepted, not
  # an oversight. S3 permits one `*` per entry, so `https://bgm-looper-*.vercel.app` is
  # the one-line change if branch previews ever need to upload.
  app_origins = [
    "https://ashutosh-pandey.com",
    "https://stage.ashutosh-pandey.com",
    "https://dev.ashutosh-pandey.com",
    "https://bgm-looper.vercel.app",
    "https://bgm-looper-git-stage-ashutosh-pandeys-projects-77cb3a00.vercel.app",
    "https://bgm-looper-git-dev-ashutosh-pandeys-projects-77cb3a00.vercel.app",
    "http://localhost:3000",
  ]
}

# --- S3 ---

# The buckets hold resume data and News Desk snapshots as well as audio, hence
# "data". One for_each over all three branches; main has no suffix.
resource "aws_s3_bucket" "data" {
  bucket = "portfolio-data${local.suffix}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = local.app_origins
    allowed_headers = ["*"]
  }
}

# Prefix-scoped rather than a blanket filter: audio is scratch and expires in a day,
# but resume/current.* must persist indefinitely. Bucket versioning is deliberately NOT
# enabled — with versioning on, these expiration rules would only write delete markers
# and every audio object would linger as a noncurrent version. See the design spec §4.2.
# Only main's bucket holds resume data, but all three get the same rules.
resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    id     = "expire-audio-uploads"
    status = "Enabled"
    filter { prefix = "uploads/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-audio-outputs"
    status = "Enabled"
    filter { prefix = "outputs/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-resume-drafts"
    status = "Enabled"
    filter { prefix = "resume/drafts/" }
    expiration { days = 1 }
  }

  rule {
    id     = "expire-resume-archive"
    status = "Enabled"
    filter { prefix = "resume/archive/" }
    expiration { days = 365 }
  }

  # There is deliberately NO catch-all rule for keys outside these prefixes,
  # even though the blanket rule this replaced would have expired them. A
  # `filter {}` expiration rule does not yield to the prefix rules — per AWS's
  # own conflict docs, an empty-filter expiration applies to every object in the
  # bucket, including ones a prefix rule already matches. Adding one at any
  # number of days would therefore delete resume/current.* and the News Desk's
  # news-desk/*.json, which are the things this configuration exists to keep.
  # https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-conflicts.html
  #
  # Stray keys are prevented at the IAM layer instead: the Vercel user is scoped
  # to these prefixes in infra/shared/shared.tf, so it cannot write elsewhere. Verified empty
  # on 2026-09-12 — zero objects outside these prefixes across all three buckets.
  # The remaining writer with bucket-wide access is the Lambda exec role; scoping
  # that too is the natural follow-up if a stray ever appears.
}

# --- Lambda ---
# Each branch's CI run updates its own function's image code — see .github/workflows/deploy.yml.

resource "aws_lambda_function" "this" {
  function_name = local.lambda_function_name
  role          = data.aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${data.aws_ecr_repository.looper.repository_url}:${var.bootstrap_image_tag}"
  timeout       = 60
  memory_size   = 1024

  lifecycle {
    ignore_changes = [image_uri]
  }
}

# --- Runaway-invoke detection ---
# There is no reserved_concurrent_executions anywhere in this config, and there cannot
# be: this account's Lambda concurrency quota (L-B99A9384) is 10, and AWS only permits
# reserving up to "unreserved account concurrency minus 100". Confirmed against the live
# account on 2026-09-16 — put-function-concurrency 0 succeeds, 2 fails with
# InvalidParameterValueException "...below its minimum value of [10]". So the quota
# itself is the concurrency ceiling (10 x 1024 MB, roughly $0.60/hour absolute worst
# case) and these alarms are the fast signal instead.
#
# Invocations, not ConcurrentExecutions: concurrency is already hard-capped at 10, so
# what is actually unbounded is how many times over that ceiling gets reused. A
# fast-failing invoke loop burns money at a high invocation count and low concurrency,
# which a concurrency alarm would never see.
#
# 50 per five minutes is ~50x any real session — one track processed is one invoke.
# This is a runaway detector, not a usage meter; raise it if normal use ever trips it.
#
# treat_missing_data = "notBreaching" because Lambda emits no Invocations datapoint when
# a function is idle, which is nearly always here. Without it every alarm sits in
# INSUFFICIENT_DATA forever and never reaches OK.
#
# Three alarms, inside CloudWatch's 10-alarm free tier — no cost.
resource "aws_cloudwatch_metric_alarm" "lambda_invocation_rate" {
  alarm_name          = "${local.lambda_function_name}-invocation-rate"
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  dimensions          = { FunctionName = local.lambda_function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 50
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [data.aws_sns_topic.budget_alerts.arn]
  ok_actions          = [data.aws_sns_topic.budget_alerts.arn]

  alarm_description = "More than 50 invocations of ${local.lambda_function_name} in five minutes. Normal use is one invocation per track processed, so this means a runaway loop. See docs/runbooks/incident-tool-down.md#rollback."
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
