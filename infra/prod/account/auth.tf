# Owner-only sign-in for /tools, /keystatic and the gated API routes (spec
# 2026-09-28-cognito-login-design.md). Production's pool; dev and stage have their
# own, in their own accounts. The app turns a verified Cognito ID token into its own
# session.
# The pool and the Verified Permissions store are in infra/modules/auth; this file
# keeps the apex CAA record and the Vercel vars that point the app at them.

locals {
  # Production only. Dev and stage sign in against their own accounts' pools, and so
  # does localhost (npm run dev), against dev's.
  login_callback_urls = ["https://${vercel_project_domain.custom.domain}/api/auth/callback"]
}

module "auth" {
  source = "../../modules/auth"

  project_name = var.project_name
  # Managed login on the site's own domain, so passkeys bind to a hostname we own.
  auth_domain          = "auth.${vercel_project_domain.custom.domain}"
  dns_domain           = vercel_project_domain.custom.domain
  vercel_team_id       = local.vercel_team_id
  callback_urls        = local.login_callback_urls
  ses_identity         = aws_sesv2_email_identity.domain.email_identity
  ses_identity_arn     = aws_sesv2_email_identity.domain.arn
  from_email_address   = "Sign-in <no-reply@${aws_sesv2_email_identity.domain.email_identity}>"
  google_client_id     = var.google_client_id
  google_client_secret = var.google_client_secret
  owner_email          = var.alert_email
  account_id           = data.aws_caller_identity.current.account_id
  region               = var.aws_region

  # The certificate validation needs the CAA record below. The module has no data
  # sources, so this defers nothing to apply time.
  depends_on = [vercel_dns_record.caa_amazon]
}

# Vercel's system CAA records allow only Sectigo, Let's Encrypt and Google, so ACM
# fails with CAA_ERROR without this. It can't sit on auth. itself, which is a CNAME.
resource "vercel_dns_record" "caa_amazon" {
  team_id = local.vercel_team_id
  domain  = vercel_project_domain.custom.domain
  name    = ""
  type    = "CAA"
  value   = "0 issue \"amazon.com\""
  ttl     = 60
}

resource "vercel_project_environment_variable" "cognito_domain" {
  project_id = vercel_project.looper.id
  key        = "COGNITO_DOMAIN"
  value      = module.auth.domain_url
  target     = ["production"]
  sensitive  = false
}

resource "vercel_project_environment_variable" "cognito_client_id" {
  project_id = vercel_project.looper.id
  key        = "COGNITO_CLIENT_ID"
  value      = module.auth.client_id
  target     = ["production"]
  sensitive  = false
}

resource "vercel_project_environment_variable" "cognito_user_pool_id" {
  project_id = vercel_project.looper.id
  key        = "COGNITO_USER_POOL_ID"
  value      = module.auth.user_pool_id
  target     = ["production"]
  sensitive  = false
}

# --- Moved into infra/modules/auth. Production's resources keep their state. ---

moved {
  from = aws_cognito_user_pool.owner
  to   = module.auth.aws_cognito_user_pool.owner
}

moved {
  from = aws_sesv2_email_identity_policy.cognito
  to   = module.auth.aws_sesv2_email_identity_policy.cognito
}

moved {
  from = aws_acm_certificate.auth
  to   = module.auth.aws_acm_certificate.auth
}

moved {
  from = vercel_dns_record.auth_acm
  to   = module.auth.vercel_dns_record.auth_acm
}

moved {
  from = aws_acm_certificate_validation.auth
  to   = module.auth.aws_acm_certificate_validation.auth
}

moved {
  from = aws_cognito_user_pool_domain.custom
  to   = module.auth.aws_cognito_user_pool_domain.custom
}

moved {
  from = vercel_dns_record.auth
  to   = module.auth.vercel_dns_record.auth
}

moved {
  from = aws_cognito_identity_provider.google
  to   = module.auth.aws_cognito_identity_provider.google
}

moved {
  from = aws_cognito_user_pool_client.web
  to   = module.auth.aws_cognito_user_pool_client.web
}

moved {
  from = aws_cognito_managed_login_branding.web
  to   = module.auth.aws_cognito_managed_login_branding.web
}

moved {
  from = random_password.owner_cognito
  to   = module.auth.random_password.owner_cognito
}

moved {
  from = aws_cognito_user.owner
  to   = module.auth.aws_cognito_user.owner
}

moved {
  from = aws_verifiedpermissions_policy_store.site
  to   = module.auth.aws_verifiedpermissions_policy_store.site
}

moved {
  from = aws_verifiedpermissions_schema.site
  to   = module.auth.aws_verifiedpermissions_schema.site
}

moved {
  from = aws_verifiedpermissions_policy.site
  to   = module.auth.aws_verifiedpermissions_policy.site
}

moved {
  from = aws_verifiedpermissions_identity_source.cognito
  to   = module.auth.aws_verifiedpermissions_identity_source.cognito
}

moved {
  from = aws_cognito_user_group.owner
  to   = module.auth.aws_cognito_user_group.owner
}

moved {
  from = aws_cognito_user_group.friends
  to   = module.auth.aws_cognito_user_group.friends
}

moved {
  from = aws_cognito_user_in_group.owner
  to   = module.auth.aws_cognito_user_in_group.owner
}
