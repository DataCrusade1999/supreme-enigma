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
