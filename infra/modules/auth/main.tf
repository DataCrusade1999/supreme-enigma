# Sign-in and access control for one AWS account: the Cognito pool behind managed
# login on auth_domain, and the Verified Permissions store that decides every gated
# request. Production's `infra/shared` calls it, and so does each nonprod account.
#
# No data sources, on purpose: shared's call depends_on the apex CAA record, and a
# module-level depends_on defers every data source inside to apply time. The
# account ID and region come in as inputs instead.

# --- Cognito: owner-only sign-in for /tools, /keystatic and the gated API routes
#     (spec 2026-09-28-cognito-login-design.md) ---

resource "aws_cognito_user_pool" "owner" {
  name           = "${var.project_name}-owner"
  user_pool_tier = "ESSENTIALS"
  # No deletion_protection: infra/shared must stay destroyable by the kill-switch
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

  # Cognito accepts this relying party only once the custom domain below exists, so
  # a from-scratch apply fails here after creating the pool. Recovery:
  # .claude/rules/infra.md ("Cognito WebAuthn on a from-scratch apply").
  # Passkeys are bound to this hostname: they keep working with any login service
  # served at var.auth_domain, and stop working if that hostname changes.
  # webauthn_enabled = false leaves the block out for a new pool's first apply.
  dynamic "web_authn_configuration" {
    for_each = var.webauthn_enabled ? [1] : []
    content {
      relying_party_id  = var.auth_domain
      user_verification = "preferred"
    }
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
    source_arn            = var.ses_identity_arn
    from_email_address    = var.from_email_address
  }

  depends_on = [aws_sesv2_email_identity_policy.cognito]
}

# DEVELOPER mode sends as the domain identity, so the identity has to let Cognito
# do that. The condition allows any user pool in this account (userpool/*), not
# only this one: naming aws_cognito_user_pool.owner.arn would be a dependency
# cycle, since the pool depends on this policy.
resource "aws_sesv2_email_identity_policy" "cognito" {
  email_identity = var.ses_identity
  policy_name    = "cognito-owner-pool"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cognito-idp.amazonaws.com" }
      Action    = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource  = var.ses_identity_arn
      Condition = {
        StringEquals = { "aws:SourceAccount" = var.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:aws:cognito-idp:${var.region}:${var.account_id}:userpool/*" }
      }
    }]
  })
}

# Cognito serves a custom domain through CloudFront, so the certificate has to be in
# us-east-1 (var.region already is).
resource "aws_acm_certificate" "auth" {
  domain_name       = var.auth_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Vercel wants the record name relative to the domain and no trailing dots.
resource "vercel_dns_record" "auth_acm" {
  for_each = {
    for o in aws_acm_certificate.auth.domain_validation_options : o.domain_name => o
  }
  team_id = var.vercel_team_id
  domain  = var.dns_domain
  name    = trimsuffix(trimsuffix(each.value.resource_record_name, "."), ".${var.dns_domain}")
  type    = each.value.resource_record_type
  value   = trimsuffix(each.value.resource_record_value, ".")
  ttl     = 60
}

# ACM also needs the apex CAA record that allows amazon.com. It lives outside this
# module, in infra/shared, whose call depends_on it; the nonprod accounts use the
# same live record.
resource "aws_acm_certificate_validation" "auth" {
  certificate_arn         = aws_acm_certificate.auth.arn
  validation_record_fqdns = [for o in aws_acm_certificate.auth.domain_validation_options : o.resource_record_name]
  depends_on              = [vercel_dns_record.auth_acm]
}

resource "aws_cognito_user_pool_domain" "custom" {
  domain                = var.auth_domain
  certificate_arn       = aws_acm_certificate_validation.auth.certificate_arn
  user_pool_id          = aws_cognito_user_pool.owner.id
  managed_login_version = 2
}

# The explicit record overrides Vercel's wildcard ALIAS for auth.
resource "vercel_dns_record" "auth" {
  team_id = var.vercel_team_id
  domain  = var.dns_domain
  name    = trimsuffix(var.auth_domain, ".${var.dns_domain}")
  type    = "CNAME"
  value   = aws_cognito_user_pool_domain.custom.cloudfront_distribution
  ttl     = 300
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

  # Cognito fills in Google's endpoints itself; without this every plan strips them.
  lifecycle {
    ignore_changes = [
      provider_details["attributes_url"],
      provider_details["attributes_url_add_attributes"],
      provider_details["authorize_url"],
      provider_details["oidc_issuer"],
      provider_details["token_request_method"],
      provider_details["token_url"],
    ]
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name            = "web"
  user_pool_id    = aws_cognito_user_pool.owner.id
  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  callback_urls                        = var.callback_urls
  supported_identity_providers         = ["COGNITO", aws_cognito_identity_provider.google.provider_name]
  explicit_auth_flows                  = ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"

  # The ID token is what Verified Permissions checks, so its lifetime is how long
  # a removed member keeps access. The refresh token matches the old 7-day session.
  id_token_validity       = 15
  access_token_validity   = 15
  refresh_token_validity  = 7
  enable_token_revocation = true

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}

locals {
  branding_assets = {
    "header-logo" = "PAGE_HEADER_LOGO"
    "form-logo"   = "FORM_LOGO"
    "background"  = "PAGE_BACKGROUND"
  }
}

# Managed login v2 serves no pages for a client without a branding style.
# branding.json is Cognito's full merged settings document with the site's
# colours, square corners and left-aligned form written over the defaults.
# Managed login has no font setting, so the site's type only appears in the
# SVGs under branding/, where it is outlined to paths.
resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id = aws_cognito_user_pool.owner.id
  client_id    = aws_cognito_user_pool_client.web.id
  settings     = jsonencode(jsondecode(file("${path.module}/branding.json")))

  # One file per category and colour mode: branding/<file>-dark.svg and -light.svg.
  dynamic "asset" {
    for_each = {
      for pair in setproduct(keys(local.branding_assets), ["dark", "light"]) :
      "${pair[0]}-${pair[1]}" => { category = local.branding_assets[pair[0]], mode = upper(pair[1]) }
    }
    content {
      category   = asset.value.category
      color_mode = asset.value.mode
      extension  = "SVG"
      bytes      = filebase64("${path.module}/branding/${asset.key}.svg")
    }
  }

  # The page asks for the favicon of its own colour mode and ignores a DYNAMIC
  # one, so the same file goes in once per mode.
  dynamic "asset" {
    for_each = toset(["DARK", "LIGHT"])
    content {
      category   = "FAVICON_SVG"
      color_mode = asset.value
      extension  = "SVG"
      bytes      = filebase64("${path.module}/branding/favicon.svg")
    }
  }
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
  username       = var.owner_email
  password       = random_password.owner_cognito.result
  message_action = "SUPPRESS"

  attributes = {
    email          = var.owner_email
    email_verified = "true"
  }

  # Cognito writes "identities" when a federated sign-in is linked to this user
  # (docs/runbooks/link-owner-google.md). Removing it would undo the link.
  lifecycle {
    ignore_changes = [attributes["identities"]]
  }
}

# --- Verified Permissions: fine-grained access to /tools (spec
#     2026-09-29-access-control-design.md). It decides every gated request from the
#     Cedar files under cedar/, with the Cognito user pool as its identity source ---

resource "aws_verifiedpermissions_policy_store" "site" {
  description = "Access to the /tools namespace"

  validation_settings {
    mode = "STRICT"
  }
}

resource "aws_verifiedpermissions_schema" "site" {
  policy_store_id = aws_verifiedpermissions_policy_store.site.id

  definition {
    value = jsonencode(jsondecode(file("${path.module}/cedar/schema.cedarschema.json")))
  }
}

# One resource per file, named by the file. Group entity IDs carry the pool ID
# ("<pool>|owner"), which the files write as ${pool}.
resource "aws_verifiedpermissions_policy" "site" {
  for_each        = fileset("${path.module}/cedar/policies", "*.cedar")
  policy_store_id = aws_verifiedpermissions_policy_store.site.id

  definition {
    static {
      description = trimsuffix(each.value, ".cedar")
      statement   = templatefile("${path.module}/cedar/policies/${each.value}", { pool = aws_cognito_user_pool.owner.id })
    }
  }

  # STRICT checks each policy against the schema, so the schema has to exist first.
  depends_on = [aws_verifiedpermissions_schema.site]
}

# ID tokens from the web client become Site::User "<pool>|<sub>", and their
# cognito:groups become Site::Group parents.
resource "aws_verifiedpermissions_identity_source" "cognito" {
  policy_store_id       = aws_verifiedpermissions_policy_store.site.id
  principal_entity_type = "Site::User"

  configuration {
    cognito_user_pool_configuration {
      user_pool_arn = aws_cognito_user_pool.owner.arn
      client_ids    = [aws_cognito_user_pool_client.web.id]

      group_configuration {
        group_entity_type = "Site::Group"
      }
    }
  }

  depends_on = [aws_verifiedpermissions_schema.site]
}

resource "aws_cognito_user_group" "owner" {
  name         = "owner"
  user_pool_id = aws_cognito_user_pool.owner.id
  description  = "Everything, including the owner-only tools"
}

resource "aws_cognito_user_group" "friends" {
  name         = "friends"
  user_pool_id = aws_cognito_user_pool.owner.id
  description  = "The shareable tools' free actions; metered actions need a grant"
}

# The pool uses email as the username alias, so the email identifies the owner
# to the admin API even though Cognito stores a UUID as the username.
resource "aws_cognito_user_in_group" "owner" {
  user_pool_id = aws_cognito_user_pool.owner.id
  group_name   = aws_cognito_user_group.owner.name
  username     = aws_cognito_user.owner.username
}
