variable "env" {
  description = "main, dev or stage. main's bucket and function names carry no suffix."
  type        = string

  validation {
    condition     = contains(["main", "dev", "stage"], var.env)
    error_message = "env must be main, dev or stage."
  }
}

variable "project_name" {
  type = string
}

variable "vercel_target" {
  description = "Vercel targets for this environment's S3_BUCKET_NAME and LAMBDA_FUNCTION_NAME."
  type        = list(string)
}

variable "vercel_git_branch" {
  description = "Branch-scoped override within the preview target. Only stage sets it."
  type        = string
  default     = null
}
# Used only for each Lambda function's initial `image_uri` at creation time — every
# aws_lambda_function.this has `lifecycle.ignore_changes = [image_uri]`,
# so CI's `update-function-code` is what actually keeps the deployed image current, and
# these defaults are never consulted again after a function first exists. They only
# matter for a from-scratch recreate (e.g. after the kill-switch `terraform destroy`) —
# before re-applying, update the relevant default(s) to a tag that branch's CI has
# actually pushed (check `aws ecr describe-images --repository-name bgm-looper-lambda`).
variable "bootstrap_image_tag" {
  type = string
}
