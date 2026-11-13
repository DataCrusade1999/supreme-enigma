# Mail for ashutosh-pandey.com has two senders.
#
# SES sends Cognito sign-in codes (spec 2026-09-28-cognito-login-design.md) and,
# later, the News Desk digest (spec 2026-09-28-news-digest-design.md) and #300's
# access emails, with MAIL FROM mail.ashutosh-pandey.com. The account has SES
# production access, granted 2026-10-01 (ProductionAccessEnabled: true).
#
# Zoho Mail (#403) holds the owner's mailbox, with access@ as an alias. It owns the
# apex MX records, the apex SPF and DKIM selector zoho. Both senders share _dmarc.

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

# p=quarantine: mail whose From is this domain and that fails both aligned SPF
# and aligned DKIM goes to spam (#508). Both senders pass: Zoho on SPF and DKIM
# selector zoho, SES on DKIM and SPF for mail. (checked 2026-11-13, #403).
# No rua= address, which would publish the owner's email in DNS.
resource "vercel_dns_record" "dmarc" {
  team_id = local.vercel_team_id
  domain  = vercel_project_domain.custom.domain
  name    = "_dmarc"
  type    = "TXT"
  value   = "v=DMARC1; p=quarantine;"
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

# Zoho sends with the bare domain as its envelope sender, so the apex SPF lists
# Zoho. SES uses mail. above and needs no entry here. A new service that sends as
# the bare domain goes into this include list: a second v=spf1 record at the apex
# is a permerror. -all since Zoho's mail showed spf=pass (#403, #508). A change
# here makes Vercel replace the record, so check afterwards for exactly one v=spf1.
resource "vercel_dns_record" "apex_spf" {
  team_id = local.vercel_team_id
  domain  = vercel_project_domain.custom.domain
  name    = ""
  type    = "TXT"
  value   = "v=spf1 include:zoho.in -all"
  ttl     = 1800
}

# Zoho Mail domain verification (#403). Kept after verifying: removing it can make Zoho ask to verify again.
resource "vercel_dns_record" "zoho_verification" {
  team_id = local.vercel_team_id
  domain  = vercel_project_domain.custom.domain
  name    = ""
  type    = "TXT"
  value   = "zoho-verification=zb62690927.zmverify.zoho.in"
  ttl     = 1800
}

# Zoho Mail receives the domain's mail (#403). Keyed by priority, so an instance's
# address stays the same if a host name changes. Don't add another apex MX:
# receivers would split mail between providers.
locals {
  zoho_mx = {
    "10" = "mx.zoho.in"
    "20" = "mx2.zoho.in"
    "50" = "mx3.zoho.in"
  }
}

resource "vercel_dns_record" "zoho_mx" {
  for_each    = local.zoho_mx
  team_id     = local.vercel_team_id
  domain      = vercel_project_domain.custom.domain
  name        = ""
  type        = "MX"
  value       = each.value
  mx_priority = tonumber(each.key)
  ttl         = 1800
}

# Zoho Mail's DKIM key, selector zoho, 2048-bit (#403). Its name differs from
# SES's <token>._domainkey CNAMEs above, so the two don't conflict.
resource "vercel_dns_record" "zoho_dkim" {
  team_id = local.vercel_team_id
  domain  = vercel_project_domain.custom.domain
  name    = "zoho._domainkey"
  type    = "TXT"
  value   = "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3xsBL5HuGIWa2kM7E0MGQaAquDj9Wz+IUSpZDkOy4b5J5pMa70wASq92RQYyIRDTHXPtgAnQrgYTN9fZQasN0aSo1PWbgf9XBavXaWJs3rG3lNRz2trmYiIRtYxzxh2SzvgXlX972ZLWoc99Bjp5+Fm7tkdjblciji7V6XV2CDIDbISX8ByV3akL++Z3MjxtGBFpmwWxcLqC/8O4ymyNlSiOJKQMN004n2U7oPj8ds/Jp1svBm/6emIfMba64kmHyV2k2yDmtRsB6gltiyXAksY3Zk0zbrLkjBsQ2Et3n8LsriJ0Q9PK+1eeRL9AbLkg6rvr1etzjl2jXnw4PFP4pwIDAQAB"
  ttl     = 1800
}

# The owner's address stays a verified SES identity, though delivery to it no
# longer depends on that since production access was granted. SES emailed a link
# to this address on first apply; it had to be clicked once.
resource "aws_sesv2_email_identity" "owner" {
  email_identity = var.alert_email
}

# --- Bounces and complaints (#510) ---
# What the SES production-access case (179068422100658) committed to: SES stops
# sending to an address that bounced or complained, and the rates are watched.
# Feedback forwarding mails each notice to the sender, no-reply@, which is a Zoho
# alias of the owner's mailbox.
resource "aws_sesv2_account_suppression_attributes" "site" {
  suppressed_reasons = ["BOUNCE", "COMPLAINT"]
}

# AWS reviews an account at a 5% bounce rate or a 0.1% complaint rate. Both alarms
# go to the budget-alerts topic, whose policy already lets CloudWatch publish.
# treat_missing_data = "notBreaching" because SES emits nothing while idle.
locals {
  ses_reputation_alarms = {
    bounce    = { metric = "Reputation.BounceRate", threshold = 0.05 }
    complaint = { metric = "Reputation.ComplaintRate", threshold = 0.001 }
  }
}

resource "aws_cloudwatch_metric_alarm" "ses_reputation" {
  for_each            = local.ses_reputation_alarms
  alarm_name          = "${var.project_name}-ses-${each.key}-rate"
  namespace           = "AWS/SES"
  metric_name         = each.value.metric
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
  ok_actions          = [aws_sns_topic.budget_alerts.arn]

  alarm_description = "SES ${each.key} rate at or above AWS's review threshold. Check bounce or complaint notices in the no-reply@ alias and stop the sender before AWS pauses sending."
}
