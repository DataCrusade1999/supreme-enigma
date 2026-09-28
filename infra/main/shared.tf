# Resources that exist once and are used by all three environments (main/dev/stage) —
# the ECR repo, IAM (exec role + service-account users), the Vercel project itself, and
# the app secrets/config that don't vary by branch. Per-branch resources (Lambda functions,
# S3 buckets, and the env vars that point at them) live in environments.tf instead.

locals {
  # GitHub issues an *immutable* subject for this repo — GET
  # /repos/DataCrusade1999/supreme-enigma/actions/oidc/customization/sub returns
  # use_default: true, use_immutable_subject: true, and this exact sub_claim_prefix.
  # The sub therefore carries numeric owner and repo IDs rather than the plain names,
  # and the name-only form `repo:${var.github_repo}:...` is never issued, so a trust
  # policy written against it can never match. Copied verbatim from that API response;
  # do not rebuild it out of var.github_repo.
  github_sub_prefix = "repo:DataCrusade1999@57610394/supreme-enigma@1313947304"

  # Vercel account slug, the personal Hobby scope. It appears in the OIDC issuer URL,
  # the aud claim and the sub claim, so it is not cosmetic. Read off any deployment
  # inspector URL (vercel.com/<slug>/bgm-looper/...) — `list_teams` returns [] on a
  # personal scope, but OIDC still keys on the slug.
  vercel_team_slug = "ashutosh-pandeys-projects-77cb3a00"

  lambda_function_name = "${var.project_name}-processor"
  lambda_function_arn  = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.lambda_function_name}"

  all_lambda_function_arns = concat(
    [local.lambda_function_arn],
    [for f in aws_lambda_function.looper_env : f.arn]
  )
  all_lambda_function_names = concat(
    [local.lambda_function_name],
    [for f in aws_lambda_function.looper_env : f.function_name]
  )
  all_data_bucket_arns = [for b in aws_s3_bucket.data : b.arn]
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

# --- IAM: one Lambda exec role shared by all three functions. The Vercel runtime and CI
#     deploy identities are federated roles, further down beside their OIDC providers —
#     there are no IAM users and no long-lived access keys in this project ---

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
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = [for arn in local.all_data_bucket_arns : "${arn}/*"]
    }]
  })
}

locals {
  # Only main's bucket holds resume data — dev/stage read and write it too, via the
  # env-agnostic RESUME_BUCKET_NAME. See the design spec §4.1.
  resume_bucket_arn = aws_s3_bucket.data["main"].arn
}

# --- GitHub Actions OIDC: how deploy.yml authenticates to AWS. It replaced an IAM user
#     with a permanent access key pair (#155); the user and its key were deleted once a
#     real deploy had run on all three branches through this role. ---

# No thumbprint_list: AWS validates token.actions.githubusercontent.com against its own
# trusted-root CA library, so pinning a leaf thumbprint here only creates something that
# breaks when GitHub rotates its certificate.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "ci_deploy" {
  name = "${var.project_name}-ci-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Condition = {
        # StringEquals on an explicit list of the three permanent branches, NOT
        # StringLike with a wildcard. A wildcard `sub` would also match a
        # pull_request context, which is what a fork PR runs as — that is the
        # documented way this trust policy gets abused. deploy.yml declares no
        # `environment:`, so the ref: form is the sub GitHub actually issues.
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = [
            "${local.github_sub_prefix}:ref:refs/heads/main",
            "${local.github_sub_prefix}:ref:refs/heads/dev",
            "${local.github_sub_prefix}:ref:refs/heads/stage",
          ]
        }
      }
    }]
  })
}

# Carried over verbatim from the deleted ci-deploy user's inline policy — the migration
# moved the identity, not the permissions.
resource "aws_iam_role_policy" "ci_deploy" {
  name = "${var.project_name}-ci-deploy-policy"
  role = aws_iam_role.ci_deploy.id

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

# --- Vercel OIDC: how the app reaches S3 and Lambda at runtime, via awsCredentials() in
#     web/lib/aws.ts reading APP_AWS_ROLE_ARN. It replaced an IAM user with a permanent
#     access key pair (#155); the user and its key were deleted once production, stage
#     and dev had each been exercised end to end through this role. ---

resource "aws_iam_openid_connect_provider" "vercel" {
  # Team issuer mode, set on vercel_project.looper below — the issuer carries the
  # account slug, so the global-mode URL (no slug) would not match the iss claim.
  url            = "https://oidc.vercel.com/${local.vercel_team_slug}"
  client_id_list = ["https://vercel.com/${local.vercel_team_slug}"]
}

resource "aws_iam_role" "vercel" {
  name = "${var.project_name}-vercel"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.vercel.arn }
      Condition = {
        StringEquals = {
          "oidc.vercel.com/${local.vercel_team_slug}:aud" = "https://vercel.com/${local.vercel_team_slug}"
          # Two entries, not three. Vercel has no per-branch environment: main is
          # "production" and both dev and stage deploy as "preview", so there is no
          # stage subject to name. That grants nothing new — all three branches
          # already share this one policy, exactly as the IAM user did.
          "oidc.vercel.com/${local.vercel_team_slug}:sub" = [
            "owner:${local.vercel_team_slug}:project:${var.project_name}:environment:production",
            "owner:${local.vercel_team_slug}:project:${var.project_name}:environment:preview",
          ]
        }
      }
    }]
  })
}

# Carried over from the deleted vercel-sa user's inline policy — the migration moved the
# identity, not the permissions. ResumeHeadObjectNotFound in particular is load-bearing;
# its comment explains why. The s3:DeleteObject grant that came across with it is gone:
# nothing under web/ issues a DeleteObjectCommand, and deleting drafts is the job of the
# resume/drafts/ lifecycle rule in environments.tf, not the app's.
resource "aws_iam_role_policy" "vercel" {
  name = "${var.project_name}-vercel-policy"
  role = aws_iam_role.vercel.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AudioScratchObjects"
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject"]
        Resource = flatten([
          for arn in local.all_data_bucket_arns : ["${arn}/uploads/*", "${arn}/outputs/*"]
        ])
      },
      {
        Sid      = "ResumeObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${local.resume_bucket_arn}/resume/*"]
      },
      {
        # HeadObject on a key that does not exist returns 403, not 404, unless the
        # caller holds s3:ListBucket on the bucket — so without this the app's
        # objectExists() rethrows on every absent key and the first extraction and
        # the first publish both 500. Deliberately unconditioned: S3 evaluates this
        # for its 404-vs-403 decision with no s3:prefix in context, so an
        # s3:prefix-scoped grant does not restore the 404. Bucket ARN only, so this
        # grants listing key names in main's bucket and nothing else — GetObject
        # stays scoped to uploads/, outputs/ and resume/ above.
        Sid      = "ResumeHeadObjectNotFound"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [local.resume_bucket_arn]
      },
      {
        Sid      = "NewsDeskObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = [for arn in local.all_data_bucket_arns : "${arn}/news-desk/*"]
      },
      {
        # Same reason as ResumeHeadObjectNotFound above: without ListBucket, S3 answers
        # a GetObject for a missing key with 403, not 404. The News Desk's first page
        # load reads a snapshot that does not exist yet, and would report that as a
        # permissions failure. Grants listing key names in the three data buckets.
        Sid      = "NewsDeskMissingSnapshotIs404"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = local.all_data_bucket_arns
      },
      {
        Sid      = "InvokeProcessor"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
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
  root_directory = "web"

  # Only build when something the app actually builds from changed. Vercel's
  # contract is inverted from the usual reading: exit 0 skips the build, exit 1
  # issues one — which is exactly what `git diff --quiet` returns for "no
  # differences" and "differences", so no wrapper logic is needed. Same
  # hand-rolled `git diff --quiet` as deploy.yml's `changes` job.
  #
  # An allowlist rather than a denylist of lambda/infra/docs: root_directory is
  # "web", and the only other build input is content/ (the git-backed Keystatic
  # blog, which must keep triggering rebuilds). The failure mode to know about
  # is that a *new* top-level directory that becomes build-relevant would
  # silently stop deploying until it is added here.
  #
  # Vercel runs this with the working directory set to root_directory, and git
  # pathspecs resolve relative to the cwd — so a bare `web content` would look
  # for web/web and web/content, never match, always exit 0 and skip every
  # build (#229). The `:(top)` magic prefix anchors each pathspec to the repo
  # root, which holds whatever root_directory is set to.
  #
  # This also makes Instant Rollback usable. On Hobby it only reaches the
  # immediately previous production deployment, and the release job pushes a
  # CHANGELOG-only commit to main right after each promotion merge — without
  # this, that commit is its own deployment and the single rollback step
  # reverts a markdown heading instead of the release.
  ignore_command = "git diff --quiet HEAD^ HEAD -- ':(top)web' ':(top)content'"

  # The resume publish route refuses to run unless VERCEL_ENV is "production"
  # (spec §7.3), and VERCEL_ENV is a Vercel system variable. The provider
  # defaults this to false, which leaves system variables unexposed at runtime —
  # the gate would then read undefined and refuse on production too, so the
  # resume could never be published. Explicit here rather than left to the
  # default, because the route's behaviour depends on it.
  automatically_expose_system_environment_variables = true

  git_repository = {
    type              = "github"
    repo              = var.github_repo
    production_branch = "main"
  }

  # Team mode puts the account slug in the iss claim, which is what
  # aws_iam_openid_connect_provider.vercel's URL is registered as. Global mode would
  # issue a slugless iss that no longer matches the provider.
  oidc_token_config = { issuer_mode = "team" }

  # Preview deployments (dev/stage) are publicly reachable. The AWS DevOps Agent's
  # UI release testing cannot get through Vercel Authentication: it navigates to
  # sub-paths directly, so the bypass token in the test profile's query string is
  # never carried over, and the plan-generation step truncates the token when the
  # agent tries to re-add it itself. Execution 6d2c9593 blocked 12/12 test cases
  # on this. The gated parts of the app (/tools/bgm-looper, /api/looper,
  # /keystatic) are protected by APP_PASSWORD in web/lib/route-gate.ts regardless,
  # so this exposes only the public portfolio pages, which are already public on
  # production.
  vercel_authentication = { deployment_type = "none" }
}

# Bought through Vercel on 2026-09-28, so it lives in the same team and Vercel
# runs its DNS. No git_branch, so it serves production (main).
# bgm-looper.vercel.app keeps working alongside it.
resource "vercel_project_domain" "custom" {
  project_id = vercel_project.looper.id
  domain     = "ashutosh-pandey.com"
}

resource "vercel_project_domain" "custom_www" {
  project_id           = vercel_project.looper.id
  domain               = "www.ashutosh-pandey.com"
  redirect             = vercel_project_domain.custom.domain
  redirect_status_code = 308
}

# Branch domains: each serves the latest deployment of its branch, so they pick
# up the same git_branch-scoped env vars (bucket, Lambda) as the vercel.app
# branch URLs. Previews have no Vercel Authentication (see above), so these
# are public; the tools stay behind APP_PASSWORD.
resource "vercel_project_domain" "custom_branch" {
  for_each   = toset(["dev", "stage"])
  project_id = vercel_project.looper.id
  domain     = "${each.key}.${vercel_project_domain.custom.domain}"
  git_branch = each.key
}

# --- Firewall ---

# web/lib/rate-limit.ts caps /api/login at 5 attempts per 15 minutes, but its
# counter is a Map in serverless instance memory — its own header comment notes
# that an attacker spread across cold starts gets more than that in total. This
# rule is the edge-side backstop for exactly that case: it lives on the Edge
# Network, so it counts across instances.
#
# 10/600s is deliberately looser than the app-level limiter, not tighter. A
# normal wrong-password run still trips the app's 429 first and gets its
# Retry-After header; this only fires on volume the in-memory counter cannot
# see. 600s is the maximum window the Hobby plan allows, and this consumes the
# one free rate-limit rule (Hobby also caps total custom rules at 3).
resource "vercel_firewall_config" "looper" {
  project_id = vercel_project.looper.id

  rules {
    rule {
      name        = "Rate limit login"
      description = "Cap /api/login attempts per source across serverless instances"

      condition_group = [{
        conditions = [{
          type  = "path"
          op    = "pre"
          value = "/api/login"
        }]
      }]

      action = {
        action = "rate_limit"
        rate_limit = {
          limit  = 10
          window = 600
          keys   = ["ip", "ja4"]
          algo   = "fixed_window"
          action = "deny"
        }
        action_duration = "10m"
      }
    }
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

# APP_AWS_ROLE_ARN, not AWS_ROLE_ARN. The AWS SDK's default credential chain reads
# AWS_ROLE_ARN itself and would try web-identity resolution from a token file that does
# not exist on Vercel. Same collision APP_AWS_REGION exists to avoid.
#
# This is now the app's only credential source — there is no AWS_ACCESS_KEY_ID to fall
# back to. awsCredentials() in web/lib/aws.ts still treats the variable as optional, which
# is what keeps the unit tests and local `npm run dev` working on their own static keys.
resource "vercel_project_environment_variable" "aws_role_arn" {
  project_id = vercel_project.looper.id
  key        = "APP_AWS_ROLE_ARN"
  value      = aws_iam_role.vercel.arn
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "aws_region" {
  project_id = vercel_project.looper.id
  key        = "APP_AWS_REGION"
  value      = var.aws_region
  target     = local.env_targets
  sensitive  = false
}

# All three branches read and write the resume from main's bucket, so unlike
# S3_BUCKET_NAME this is not overridden per branch. See the design spec §4.1.
resource "vercel_project_environment_variable" "resume_bucket_name" {
  project_id = vercel_project.looper.id
  key        = "RESUME_BUCKET_NAME"
  value      = aws_s3_bucket.data["main"].id
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "openrouter_api_key" {
  project_id = vercel_project.looper.id
  key        = "OPENROUTER_API_KEY"
  value      = var.openrouter_api_key
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "openrouter_model" {
  project_id = vercel_project.looper.id
  key        = "OPENROUTER_MODEL"
  value      = var.openrouter_model
  target     = local.env_targets
  sensitive  = false
}

# Kept as config so the extract route can be pointed at any OpenAI-compatible
# endpoint without a code change — see the design spec §5.2.
resource "vercel_project_environment_variable" "openrouter_base_url" {
  project_id = vercel_project.looper.id
  key        = "OPENROUTER_BASE_URL"
  value      = "https://openrouter.ai/api/v1"
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "news_desk_model" {
  project_id = vercel_project.looper.id
  key        = "NEWS_DESK_MODEL"
  value      = var.news_desk_model
  target     = local.env_targets
  sensitive  = false
}

# Automation bypass token so the AWS DevOps Agent's release testing can reach the
# stage preview URL without disabling Vercel Authentication for every preview.
# Passed as the x-vercel-protection-bypass query param on the test profile URL.
resource "vercel_project_protection_bypass" "automation" {
  project_id = vercel_project.looper.id
  note       = "AWS DevOps Agent release testing"
}

# --- Cost guardrails ---

resource "aws_sns_topic" "budget_alerts" {
  name = "${var.project_name}-budget-alerts"
}

resource "aws_sns_topic_subscription" "budget_alerts_email" {
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic_policy" "budget_alerts" {
  arn = aws_sns_topic.budget_alerts.arn

  # This policy REPLACES the default SNS topic policy rather than adding to it, so every
  # publisher has to be named here. The cloudwatch statement is what lets
  # aws_cloudwatch_metric_alarm.lambda_invocation_rate deliver — without it the alarm
  # still transitions to ALARM and simply notifies nobody, which is the same silent
  # failure mode as an unconfirmed email subscription.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "BudgetsPublish"
        Effect    = "Allow"
        Principal = { Service = "budgets.amazonaws.com" }
        Action    = "SNS:Publish"
        Resource  = aws_sns_topic.budget_alerts.arn
        Condition = {
          StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        }
      },
      {
        Sid       = "CloudWatchAlarmsPublish"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "SNS:Publish"
        Resource  = aws_sns_topic.budget_alerts.arn
        Condition = {
          StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        }
      }
    ]
  })
}

# Measured baseline for this project is $0.11-$0.28/month (design spec §9). A $5 cap is
# roughly 20x headroom — high enough not to cry wolf, low enough to catch a runaway.
#
# Deliberately NOT filtered by tag: the magma-learning budget uses a user:project tag
# filter, but this project's resources are not consistently tagged, so a tag filter
# would silently match nothing. An unfiltered account-scoped budget is the honest
# version; tagging every resource is separate work.
resource "aws_budgets_budget" "project" {
  name         = "${var.project_name}-monthly-cap"
  budget_type  = "COST"
  limit_amount = "5.0"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 80
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
  }
}
