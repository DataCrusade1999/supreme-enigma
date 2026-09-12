variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  description = "Named AWS CLI profile Terraform authenticates with (local runs only — CI uses env-var credentials and never sets this)."
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
