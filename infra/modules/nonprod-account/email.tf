# SES for this environment's Cognito sign-in codes and Access emails. The identity is
# the branch subdomain, <env>.<dns_domain>, so production's apex identity and its DNS
# records stay untouched (spec §8). The account stays in the SES sandbox: the only
# recipient is the owner, a verified identity below.
#
# No DMARC record of its own: the apex _dmarc record (p=quarantine since #508, in
# infra/prod/account) covers subdomains that publish none. A custom MAIL FROM at
# mail.<env>.<dns_domain> (#514) aligns the mail on SPF as well as DKIM, so a DKIM
# failure alone no longer sends it to spam.

resource "aws_sesv2_email_identity" "domain" {
  email_identity = local.site_host

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# Easy DKIM: three CNAMEs. count, not for_each, because the tokens are unknown
# until the identity exists. Names are relative to the zone, so they carry the
# environment label.
resource "vercel_dns_record" "ses_dkim" {
  count   = 3
  team_id = var.vercel_team_id
  domain  = var.dns_domain
  name    = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.env}"
  type    = "CNAME"
  value   = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"
  ttl     = 1800
}

# Same as production's in infra/prod/account/email.tf: if the MX record ever goes
# missing, SES falls back to its own MAIL FROM rather than refusing to send.
resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity         = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain       = "mail.${local.site_host}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"

  depends_on = [vercel_dns_record.mail_from_mx, vercel_dns_record.mail_from_spf]
}

resource "vercel_dns_record" "mail_from_mx" {
  team_id     = var.vercel_team_id
  domain      = var.dns_domain
  name        = "mail.${var.env}"
  type        = "MX"
  value       = "feedback-smtp.${local.region}.amazonses.com"
  mx_priority = 10
  ttl         = 1800
}

resource "vercel_dns_record" "mail_from_spf" {
  team_id = var.vercel_team_id
  domain  = var.dns_domain
  name    = "mail.${var.env}"
  type    = "TXT"
  value   = "v=spf1 include:amazonses.com ~all"
  ttl     = 1800
}

# In the sandbox SES delivers only to verified addresses. SES emails a link to this
# address on first apply; it must be clicked once. Production's verification doesn't
# carry over: identities are per account.
resource "aws_sesv2_email_identity" "owner" {
  email_identity = var.alert_email
}
