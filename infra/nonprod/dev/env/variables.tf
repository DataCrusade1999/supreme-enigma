variable "aws_profile" {
  description = "Named AWS CLI profile. Null (the default) uses the environment: AWS_PROFILE=personal-dev locally (the backend and the account stack's remote state read it too), OIDC credentials in CI."
  type        = string
  default     = null
}

variable "vercel_api_token" {
  type      = string
  sensitive = true
}
