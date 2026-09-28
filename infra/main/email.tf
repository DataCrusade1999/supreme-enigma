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

# In the sandbox SES delivers only to verified addresses. SES emails a link to this
# address on first apply; it must be clicked once.
resource "aws_sesv2_email_identity" "owner" {
  email_identity = var.alert_email
}
