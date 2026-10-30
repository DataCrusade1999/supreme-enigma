output "user_pool_id" {
  value = aws_cognito_user_pool.owner.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.owner.arn
}

output "client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "domain_url" {
  value = "https://${var.auth_domain}"
}

output "policy_store_id" {
  value = aws_verifiedpermissions_policy_store.site.id
}

output "policy_store_arn" {
  value = aws_verifiedpermissions_policy_store.site.arn
}

output "access_grants_table_name" {
  value = aws_dynamodb_table.access_grants.name
}

output "access_grants_table_arn" {
  value = aws_dynamodb_table.access_grants.arn
}
