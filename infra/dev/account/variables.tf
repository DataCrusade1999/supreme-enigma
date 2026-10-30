variable "aws_profile" {
  description = "Named AWS CLI profile. Null (the default) uses the environment: AWS_PROFILE=personal-dev locally (the backend reads it too), OIDC credentials in CI."
  type        = string
  default     = null
}

variable "vercel_api_token" {
  type      = string
  sensitive = true
}

variable "alert_email" {
  description = "Receives the invocation alarm, is the SES sandbox recipient and the Cognito owner user. The SNS subscription and the SES identity each need one click from the inbox after the first apply."
  type        = string
}

variable "google_client_id" {
  type = string
}

variable "google_client_secret" {
  type      = string
  sensitive = true
}

# false only for the first apply of the pool, then back to true:
# .claude/rules/infra.md ("Cognito WebAuthn on a from-scratch apply").
variable "webauthn_enabled" {
  type    = bool
  default = true
}
