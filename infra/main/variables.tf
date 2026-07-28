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
