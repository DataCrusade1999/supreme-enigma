variable "env" {
  description = "The environment this account holds. Its branch is the only ref the apply and deploy roles trust."
  type        = string

  validation {
    condition     = contains(["dev", "stage"], var.env)
    error_message = "env must be dev or stage. Production lives in infra/shared and infra/envs/main."
  }
}

variable "project_name" {
  type = string
}

variable "github_sub_prefix" {
  description = "GitHub's immutable OIDC subject prefix for the repo, copied verbatim from the API. See the root's comment."
  type        = string
}

variable "vercel_team_slug" {
  description = "Vercel account slug. It is in the OIDC issuer URL, the aud claim and the sub claim."
  type        = string
}

variable "vercel_team_id" {
  description = "Vercel scope that owns dns_domain. The domains API answers 403 without it (.claude/rules/infra.md)."
  type        = string
}

variable "dns_domain" {
  description = "Vercel DNS zone. This environment's host, SES identity and auth domain sit under <env>.<dns_domain>."
  type        = string
}

variable "alert_email" {
  description = "Receives the alarm emails and is the SES sandbox recipient and Cognito owner user. The SNS subscription and the SES identity each need one click from the inbox after the first apply."
  type        = string
}

variable "google_client_id" {
  type = string
}

variable "google_client_secret" {
  type      = string
  sensitive = true
}

# false only for the first apply of a new pool. Cognito rejects the custom-domain
# relying party until the pool's domain exists, which Terraform creates after the
# pool: .claude/rules/infra.md ("Cognito WebAuthn on a from-scratch apply").
variable "webauthn_enabled" {
  type    = bool
  default = true
}
