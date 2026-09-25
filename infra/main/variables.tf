variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  description = "Named AWS CLI profile Terraform authenticates with. Local runs only — Terraform is never applied from CI, and the deploy workflow authenticates by assuming bgm-looper-ci-deploy through OIDC rather than with any profile or key."
  type        = string
  default     = "personal"
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

# Used only for each Lambda function's initial `image_uri` at creation time — every
# aws_lambda_function.looper/looper_env has `lifecycle.ignore_changes = [image_uri]`,
# so CI's `update-function-code` is what actually keeps the deployed image current, and
# these defaults are never consulted again after a function first exists. They only
# matter for a from-scratch recreate (e.g. after the kill-switch `terraform destroy`) —
# before re-applying, update the relevant default(s) to a tag that branch's CI has
# actually pushed (check `aws ecr describe-images --repository-name bgm-looper-lambda`).
variable "bootstrap_image_tag_main" {
  type    = string
  default = "main-a61a6a20eb4f0f84b6cf292d25a0d0b5046f8f2e"
}

variable "bootstrap_image_tag_dev" {
  type    = string
  default = "dev-bdf04bfd483a13b26cb30e6a89dacc5d14101e4a"
}

variable "bootstrap_image_tag_stage" {
  type    = string
  default = "stage-0139b7ba435c89c79dc8c88bf6feb79f628753bb"
}
