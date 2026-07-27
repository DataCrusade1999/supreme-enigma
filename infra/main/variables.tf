variable "aws_region" {
  type    = string
  default = "us-east-1"
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
