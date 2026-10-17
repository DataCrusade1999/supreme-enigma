# SES for this environment's Cognito sign-in codes. The identity is the branch
# subdomain, <env>.<dns_domain>, so production's apex identity and its DNS records stay
# untouched (spec §8). The account stays in the SES sandbox: the only recipient is the
# owner, a verified identity below.
#
# No custom MAIL FROM and no DMARC record. DKIM alone aligns this subdomain's mail
# for DMARC, and the apex _dmarc record (p=none, in infra/shared) already covers
# subdomains that publish none of their own.

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

# In the sandbox SES delivers only to verified addresses. SES emails a link to this
# address on first apply; it must be clicked once. Production's verification doesn't
# carry over: identities are per account.
resource "aws_sesv2_email_identity" "owner" {
  email_identity = var.alert_email
}
