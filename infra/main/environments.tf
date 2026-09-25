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

locals {
  # The three deployment origins that issue presigned-URL uploads. Wildcard origins were
  # not an authorization hole (the signature grants access, not CORS) but there is no
  # reason for any other site's JS to be able to read these responses.
  #
  # This list is exhaustive and deliberately has no wildcard: these four origins are the
  # only places a browser upload works. A one-off feature-branch preview
  # (bgm-looper-git-<branch>-….vercel.app), a team alias, or a dev server on a port other
  # than 3000 will fail the PUT with an opaque browser CORS error — that is accepted, not
  # an oversight. S3 permits one `*` per entry, so `https://bgm-looper-*.vercel.app` is
  # the one-line change if branch previews ever need to upload.
  app_origins = [
    "https://bgm-looper.vercel.app",
    "https://bgm-looper-git-stage-ashutosh-pandeys-projects-77cb3a00.vercel.app",
    "https://bgm-looper-git-dev-ashutosh-pandeys-projects-77cb3a00.vercel.app",
    "http://localhost:3000",
  ]
}

resource "aws_s3_bucket_cors_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

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
resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

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
  # to these prefixes in shared.tf, so it cannot write elsewhere. Verified empty
  # on 2026-09-12 — zero objects outside these prefixes across all three buckets.
  # The remaining writer with bucket-wide access is the Lambda exec role; scoping
  # that too is the natural follow-up if a stray ever appears.
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
    allowed_origins = local.app_origins
    allowed_headers = ["*"]
  }
}

# Kept identical to main's rules above. Only main's bucket holds resume data, but a
# matching configuration avoids a confusing diff between environments.
resource "aws_s3_bucket_lifecycle_configuration" "audio_env" {
  for_each = aws_s3_bucket.audio_env
  bucket   = each.value.id

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
}

# --- Lambda ---
# Each branch's CI run updates its own function's image code — see .github/workflows/deploy.yml.

resource "aws_lambda_function" "looper" {
  function_name = local.lambda_function_name
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.looper.repository_url}:${var.bootstrap_image_tag_main}"
  timeout       = 60
  memory_size   = 1024

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.lambda_s3]

  lifecycle {
    ignore_changes = [image_uri]
  }
}

locals {
  bootstrap_image_tag_env = {
    dev   = var.bootstrap_image_tag_dev
    stage = var.bootstrap_image_tag_stage
  }
}

resource "aws_lambda_function" "looper_env" {
  for_each      = toset(["dev", "stage"])
  function_name = "${local.lambda_function_name}-${each.key}"
  role          = aws_iam_role.lambda_exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.looper.repository_url}:${local.bootstrap_image_tag_env[each.key]}"
  timeout       = 60
  memory_size   = 1024

  depends_on = [aws_iam_role_policy_attachment.lambda_basic, aws_iam_role_policy.lambda_s3]

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
  for_each = toset(local.all_lambda_function_names)

  alarm_name          = "${each.key}-invocation-rate"
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  dimensions          = { FunctionName = each.key }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 50
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
  ok_actions          = [aws_sns_topic.budget_alerts.arn]

  alarm_description = "More than 50 invocations of ${each.key} in five minutes. Normal use is one invocation per track processed, so this means a runaway loop. See docs/runbooks/incident-tool-down.md#rollback."
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
  sensitive  = false
}

resource "vercel_project_environment_variable" "s3_bucket_preview" {
  project_id = vercel_project.looper.id
  key        = "S3_BUCKET_NAME"
  value      = aws_s3_bucket.audio_env["dev"].bucket
  target     = ["preview"]
  sensitive  = false
}

resource "vercel_project_environment_variable" "s3_bucket_stage" {
  project_id = vercel_project.looper.id
  key        = "S3_BUCKET_NAME"
  value      = aws_s3_bucket.audio_env["stage"].bucket
  target     = ["preview"]
  git_branch = "stage"
  sensitive  = false
}

resource "vercel_project_environment_variable" "lambda_function_name_production" {
  project_id = vercel_project.looper.id
  key        = "LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.looper.function_name
  target     = ["production"]
  sensitive  = false
}

resource "vercel_project_environment_variable" "lambda_function_name_preview" {
  project_id = vercel_project.looper.id
  key        = "LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.looper_env["dev"].function_name
  target     = ["preview"]
  sensitive  = false
}

resource "vercel_project_environment_variable" "lambda_function_name_stage" {
  project_id = vercel_project.looper.id
  key        = "LAMBDA_FUNCTION_NAME"
  value      = aws_lambda_function.looper_env["stage"].function_name
  target     = ["preview"]
  git_branch = "stage"
  sensitive  = false
}
