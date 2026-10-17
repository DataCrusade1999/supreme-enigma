# Read by this environment's env stack through terraform_remote_state, and set as its
# preview Vercel vars.

output "cognito_user_pool_id" {
  value = module.auth.user_pool_id
}

output "cognito_client_id" {
  value = module.auth.client_id
}

output "cognito_domain_url" {
  value = module.auth.domain_url
}

output "avp_policy_store_id" {
  value = module.auth.policy_store_id
}

output "vercel_role_arn" {
  value = aws_iam_role.vercel_preview.arn
}
