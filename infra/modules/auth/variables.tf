variable "project_name" {
  type = string
}

variable "auth_domain" {
  description = "Hostname managed login is served at, e.g. auth.ashutosh-pandey.com. Passkeys bind to it."
  type        = string
}

variable "dns_domain" {
  description = "Vercel DNS zone auth_domain sits in. The DNS record names are relative to it."
  type        = string
}

variable "vercel_team_id" {
  description = "Vercel scope that owns dns_domain. The domains API answers 403 without it (.claude/rules/infra.md)."
  type        = string
}

variable "callback_urls" {
  description = "OAuth callback URLs registered on the web client."
  type        = list(string)
}

variable "ses_identity" {
  description = "Name of the SES identity the pool sends from (the domain)."
  type        = string
}

variable "ses_identity_arn" {
  type = string
}

variable "from_email_address" {
  description = "From header of the pool's emails. Must be an address at ses_identity."
  type        = string
}

variable "google_client_id" {
  type = string
}

variable "google_client_secret" {
  type      = string
  sensitive = true
}

variable "owner_email" {
  description = "The owner's Cognito user, put in the owner group."
  type        = string
}

# Passed in rather than read from data sources: shared's call has a module-level
# depends_on, which would defer any data source in here to apply time and turn
# its no-op plan into an update.
variable "account_id" {
  type = string
}

variable "region" {
  type = string
}

# false only for the first apply of a new pool. Cognito rejects the custom-domain
# relying party until the pool's domain exists, which Terraform creates after the
# pool: .claude/rules/infra.md ("Cognito WebAuthn on a from-scratch apply").
variable "webauthn_enabled" {
  type    = bool
  default = true
}
