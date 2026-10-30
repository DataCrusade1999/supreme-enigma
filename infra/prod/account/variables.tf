variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  description = "Named AWS CLI profile. Null (the default) uses the environment: AWS_PROFILE locally, OIDC credentials in CI."
  type        = string
  default     = null
}

variable "project_name" {
  type    = string
  default = "bgm-looper"
}

variable "vercel_api_token" {
  type      = string
  sensitive = true
}

variable "app_password" {
  type      = string
  sensitive = true
}

variable "github_repo" {
  description = "owner/repo of this project on GitHub, for Vercel git integration"
  type        = string
}

variable "alert_email" {
  description = "Address that receives budget threshold notifications. The SNS email subscription must be confirmed manually from the inbox after the first apply."
  type        = string
}

variable "openrouter_api_key" {
  description = "OpenRouter key used for resume extraction. Its blast radius is OpenRouter credit only — cap the key's spend limit in the OpenRouter dashboard as a backstop the app cannot override."
  type        = string
  sensitive   = true
}

variable "openrouter_model" {
  description = "Model slug for resume extraction. A variable so switching model is config, not code — see the design spec §5.2."
  type        = string
  default     = "anthropic/claude-haiku-4.5"
}

variable "news_desk_model" {
  description = "Model slug for the News Desk's headline tagging and chat. Separate from openrouter_model so changing the resume extraction model does not change this tool."
  type        = string
  default     = "anthropic/claude-haiku-4.5"
}

# Google OAuth client for Cognito's Google sign-in, created by hand in Google Cloud
# Console (spec 2026-09-28-cognito-login-design.md §5).
variable "google_client_id" {
  type = string
}

variable "google_client_secret" {
  type      = string
  sensitive = true
}
