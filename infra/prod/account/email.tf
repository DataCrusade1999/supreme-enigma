# SES for mail sent from ashutosh-pandey.com: Cognito sign-in codes (spec
# 2026-09-28-cognito-login-design.md) and, later, the News Desk digest (spec
# 2026-09-28-news-digest-design.md). The account stays in the SES sandbox: the only
# recipient is the owner, a verified identity.

resource "aws_sesv2_email_identity" "domain" {
  email_identity = vercel_project_domain.custom.domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# Easy DKIM: three CNAMEs. count, not for_each, because the tokens are unknown
# until the identity exists.
resource "vercel_dns_record" "ses_dkim" {
  count   = 3
  team_id = local.vercel_team_id
  domain  = vercel_project_domain.custom.domain
  name    = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}._domainkey"
  type    = "CNAME"
  value   = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"
  ttl     = 1800
}

# p=none: report nothing, reject nothing, but DMARC-aware receivers see a policy.
# No rua= address, which would publish the owner's email in DNS.
resource "vercel_dns_record" "dmarc" {
  team_id = local.vercel_team_id
  domain  = vercel_project_domain.custom.domain
  name    = "_dmarc"
  type    = "TXT"
  value   = "v=DMARC1; p=none;"
  ttl     = 1800
}

# Custom MAIL FROM, so SPF passes for this domain and not only for amazonses.com:
# with it, SES mail from the domain is DMARC-aligned on SPF as well as DKIM. If
# the MX record ever goes missing, SES falls back to its own MAIL FROM rather
# than refusing to send.
locals {
  mail_from_domain = "mail.${vercel_project_domain.custom.domain}"
}

resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity         = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain       = local.mail_from_domain
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"

  depends_on = [vercel_dns_record.mail_from_mx, vercel_dns_record.mail_from_spf]
}

resource "vercel_dns_record" "mail_from_mx" {
  team_id     = local.vercel_team_id
  domain      = vercel_project_domain.custom.domain
  name        = "mail"
  type        = "MX"
  value       = "feedback-smtp.${var.aws_region}.amazonses.com"
  mx_priority = 10
  ttl         = 1800
}

resource "vercel_dns_record" "mail_from_spf" {
  team_id = local.vercel_team_id
  domain  = vercel_project_domain.custom.domain
  name    = "mail"
  type    = "TXT"
  value   = "v=spf1 include:amazonses.com ~all"
  ttl     = 1800
}

# Nothing sends with the bare domain as its envelope sender (SES uses mail. above),
# so say so. Checked 2026-09-29: no other service sends mail for this domain.
resource "vercel_dns_record" "apex_spf" {
  team_id = local.vercel_team_id
  domain  = vercel_project_domain.custom.domain
  name    = ""
  type    = "TXT"
  value   = "v=spf1 -all"
  ttl     = 1800
}

# In the sandbox SES delivers only to verified addresses. SES emails a link to this
# address on first apply; it must be clicked once.
resource "aws_sesv2_email_identity" "owner" {
  email_identity = var.alert_email
}
