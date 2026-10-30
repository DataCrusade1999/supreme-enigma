variable "env" {
  description = "dev or stage. Passed to modules/app, and names the resume policy."
  type        = string

  validation {
    condition     = contains(["dev", "stage"], var.env)
    error_message = "env must be dev or stage."
  }
}

variable "project_name" {
  description = "Prefix of every name, and the Vercel project's name."
  type        = string
}

variable "bootstrap_image_tag" {
  description = "ECR tag for the Lambda function's image at creation only; see modules/app's variable of the same name."
  type        = string
}

variable "vercel_git_branch" {
  description = "Branch-scoped override within the preview target. Null for dev (bare preview), \"stage\" for stage."
  type        = string
  default     = null
}

variable "vercel_role_arn" {
  description = "This account's bgm-looper-vercel-preview role, the value of APP_AWS_ROLE_ARN."
  type        = string
}

variable "cognito_user_pool_id" {
  description = "This account's user pool, the value of COGNITO_USER_POOL_ID."
  type        = string
}

variable "cognito_client_id" {
  description = "The user pool's app client, the value of COGNITO_CLIENT_ID."
  type        = string
}

variable "cognito_domain_url" {
  description = "The user pool's sign-in domain URL, the value of COGNITO_DOMAIN."
  type        = string
}

variable "avp_policy_store_id" {
  description = "This account's Verified Permissions policy store, the value of AVP_POLICY_STORE_ID."
  type        = string
}
