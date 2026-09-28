# Owner-only sign-in for /tools, /keystatic and the gated API routes (spec
# 2026-09-28-cognito-login-design.md). One pool for all three environments, like
# COOKIE_SECRET: the app turns a verified Cognito ID token into its own session.

locals {
  cognito_domain_prefix = "ashutosh-pandey-login"
  cognito_domain_url    = "https://${local.cognito_domain_prefix}.auth.${var.aws_region}.amazoncognito.com"
  login_callback_urls = concat(
    [for h in values(local.site_hosts) : "https://${h}/api/auth/callback"],
    ["http://localhost:3000/api/auth/callback"],
  )
}

resource "aws_cognito_user_pool" "owner" {
  name           = "${var.project_name}-owner"
  user_pool_tier = "ESSENTIALS"
  # No deletion_protection: infra/main must stay destroyable by the kill-switch
  # `terraform destroy`, and a protected pool fails that destroy partway.

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  # PASSWORD is listed so the pool accepts the policy even if AWS requires it; the
  # owner's password is random and never used.
  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD", "EMAIL_OTP", "WEB_AUTHN"]
  }

  web_authn_configuration {
    relying_party_id  = "${local.cognito_domain_prefix}.auth.${var.aws_region}.amazoncognito.com"
    user_verification = "preferred"
  }

  password_policy {
    minimum_length    = 16
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Email codes need SES in DEVELOPER mode (Essentials plan).
  email_configuration {
    email_sending_account = "DEVELOPER"
    source_arn            = aws_sesv2_email_identity.domain.arn
    from_email_address    = "Sign-in <no-reply@${aws_sesv2_email_identity.domain.email_identity}>"
  }

  depends_on = [aws_sesv2_email_identity_policy.cognito]
}

# DEVELOPER mode sends as the domain identity, so the identity has to let Cognito
# do that — and only for this pool.
resource "aws_sesv2_email_identity_policy" "cognito" {
  email_identity = aws_sesv2_email_identity.domain.email_identity
  policy_name    = "cognito-owner-pool"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cognito-idp.amazonaws.com" }
      Action    = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource  = aws_sesv2_email_identity.domain.arn
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/*" }
      }
    }]
  })
}

resource "aws_cognito_user_pool_domain" "owner" {
  domain                = local.cognito_domain_prefix
  user_pool_id          = aws_cognito_user_pool.owner.id
  managed_login_version = 2
}

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.owner.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
  }

  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
    username       = "sub"
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name            = "web"
  user_pool_id    = aws_cognito_user_pool.owner.id
  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  callback_urls                        = local.login_callback_urls
  supported_identity_providers         = ["COGNITO", aws_cognito_identity_provider.google.provider_name]
  explicit_auth_flows                  = ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
}

# Managed login v2 serves no pages for a client without a branding style.
resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id                = aws_cognito_user_pool.owner.id
  client_id                   = aws_cognito_user_pool_client.web.id
  use_cognito_provided_values = true
}

resource "random_password" "owner_cognito" {
  length      = 32
  min_upper   = 1
  min_lower   = 1
  min_numeric = 1
  min_special = 1
}

resource "aws_cognito_user" "owner" {
  user_pool_id   = aws_cognito_user_pool.owner.id
  username       = var.alert_email
  password       = random_password.owner_cognito.result
  message_action = "SUPPRESS"

  attributes = {
    email          = var.alert_email
    email_verified = "true"
  }
}

resource "vercel_project_environment_variable" "cognito_domain" {
  project_id = vercel_project.looper.id
  key        = "COGNITO_DOMAIN"
  value      = local.cognito_domain_url
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "cognito_client_id" {
  project_id = vercel_project.looper.id
  key        = "COGNITO_CLIENT_ID"
  value      = aws_cognito_user_pool_client.web.id
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "cognito_user_pool_id" {
  project_id = vercel_project.looper.id
  key        = "COGNITO_USER_POOL_ID"
  value      = aws_cognito_user_pool.owner.id
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "owner_email" {
  project_id = vercel_project.looper.id
  key        = "OWNER_EMAIL"
  value      = var.alert_email
  target     = local.env_targets
  sensitive  = true
}
