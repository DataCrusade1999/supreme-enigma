output "ecr_repository_url" {
  value = aws_ecr_repository.looper.repository_url
}

output "vercel_project_id" {
  value = vercel_project.looper.id
}

output "protection_bypass_secret" {
  value     = vercel_project_protection_bypass.automation.secret
  sensitive = true
}

output "ci_deploy_role_arn" {
  value = aws_iam_role.ci_deploy.arn
}

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

output "resume_bucket_name" {
  value = local.data_bucket_names["main"]
}

output "vpn_trust_anchor_arn" {
  value = aws_rolesanywhere_trust_anchor.vpn.arn
}

output "vpn_profile_arn" {
  value = aws_rolesanywhere_profile.vpn.arn
}

output "vpn_role_arn" {
  value = aws_iam_role.vpn_agent.arn
}
