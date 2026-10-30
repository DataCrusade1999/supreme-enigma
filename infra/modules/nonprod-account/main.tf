# The base of one nonprod account (dev 624586968135 or stage 792682047320): OIDC
# providers and roles, the ECR repo, the alerts topic, SES and sign-in. Everything here
# lives in the account the caller's provider points at and trusts nothing outside it
# (spec 2026-10-17-nonprod-accounts-design.md §4.1). The bucket, Lambda, exec role and
# alarm come from infra/modules/app, called from the app stack beside this one.

data "aws_caller_identity" "current" {}

locals {
  # Control Tower denies every other region.
  region     = "us-east-1"
  account_id = data.aws_caller_identity.current.account_id

  # The branch domain, e.g. dev.ashutosh-pandey.com. The SES identity and the auth
  # domain sit under it.
  site_host = "${var.env}.${var.dns_domain}"

  lambda_function_arn = "arn:aws:lambda:${local.region}:${local.account_id}:function:${var.project_name}-processor-${var.env}"

  # This environment's hosts only. localhost (npm run dev) signs in against dev.
  login_callback_urls = concat(
    [
      "https://${local.site_host}/api/auth/callback",
      "https://${var.project_name}-git-${var.env}-${var.vercel_team_slug}.vercel.app/api/auth/callback",
    ],
    var.env == "dev" ? ["http://localhost:3000/api/auth/callback"] : [],
  )
}

# --- ECR: this account's own repo. Only this environment's branch pushes here, so one
#     tag prefix and no cross-account pulls. ---

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
        description  = "Keep only the 1 most recent ${var.env} image"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = [var.env]
          countType     = "imageCountMoreThan"
          countNumber   = 1
        }
        action = { type = "expire" }
      }
    ]
  })
}

# --- Alerts: the topic the app stack's invocation alarm publishes to. No project
#     budget here: the aws-org repo's $2 account budget covers this account. ---

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
  # failure mode as an unconfirmed email subscription. The only publisher in this
  # account: no budget and no EventBridge rule publishes here.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudWatchAlarmsPublish"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "SNS:Publish"
        Resource  = aws_sns_topic.budget_alerts.arn
        Condition = {
          StringEquals = { "aws:SourceAccount" = local.account_id }
        }
      }
    ]
  })
}

# --- Sign-in: this account's own pool and Verified Permissions store, from the same
#     module (and Cedar files) as production's. ---

module "auth" {
  source = "../auth"

  project_name = var.project_name
  # Managed login on the branch domain, so passkeys bind to a hostname we own.
  auth_domain          = "auth.${local.site_host}"
  dns_domain           = var.dns_domain
  vercel_team_id       = var.vercel_team_id
  callback_urls        = local.login_callback_urls
  ses_identity         = aws_sesv2_email_identity.domain.email_identity
  ses_identity_arn     = aws_sesv2_email_identity.domain.arn
  from_email_address   = "Sign-in <no-reply@${aws_sesv2_email_identity.domain.email_identity}>"
  google_client_id     = var.google_client_id
  google_client_secret = var.google_client_secret
  owner_email          = var.alert_email
  account_id           = local.account_id
  region               = local.region
  webauthn_enabled     = var.webauthn_enabled

  # Waits for the branch domain's ALIAS: Cognito's custom domain needs a parent A record.
  # The apex CAA record that lets ACM issue for auth.<env> is production's, already live.
  depends_on = [vercel_dns_record.branch_domain]
}

# Records under <env>. (the SES DKIM and auth ACM records) make the name an empty
# non-terminal, so the zone's wildcard ALIAS stops serving <env>.<dns_domain>. This
# record restores the branch domain and gives Cognito's custom domain its parent A record.
resource "vercel_dns_record" "branch_domain" {
  team_id = var.vercel_team_id
  domain  = var.dns_domain
  name    = var.env
  type    = "ALIAS"
  value   = "cname.vercel-dns-017.com."
  ttl     = 60
}
