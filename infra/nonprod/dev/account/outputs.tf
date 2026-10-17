# Read by infra/nonprod/dev's env stack through terraform_remote_state.

output "cognito_user_pool_id" {
  value = module.account.cognito_user_pool_id
}

output "cognito_client_id" {
  value = module.account.cognito_client_id
}

output "cognito_domain_url" {
  value = module.account.cognito_domain_url
}

output "avp_policy_store_id" {
  value = module.account.avp_policy_store_id
}

output "vercel_role_arn" {
  value = module.account.vercel_role_arn
}
