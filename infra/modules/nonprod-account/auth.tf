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
