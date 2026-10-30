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
