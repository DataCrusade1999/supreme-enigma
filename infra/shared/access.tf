# Fine-grained access to /tools (spec 2026-09-29-access-control-design.md).
# Verified Permissions decides every gated request from the Cedar files under
# infra/modules/auth/cedar/, with the Cognito user pool as its identity source.
# The store is in module.auth (auth.tf); this file grants production's Vercel role
# use of it and of the grants table. Dev and stage have their own, in their own accounts.

resource "aws_iam_role_policy" "vercel_access" {
  name = "${var.project_name}-vercel-access"
  role = aws_iam_role.vercel.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AuthorizeRequests"
        Effect   = "Allow"
        Action   = ["verifiedpermissions:IsAuthorizedWithToken"]
        Resource = [module.auth.policy_store_arn]
      },
      {
        Sid      = "AccessGrants"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"]
        Resource = [module.auth.access_grants_table_arn]
      },
      {
        Sid    = "ManageAccess"
        Effect = "Allow"
        Action = [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminUserGlobalSignOut",
          "cognito-idp:AdminDeleteUser",
        ]
        Resource = [module.auth.user_pool_arn]
      },
    ]
  })
}

resource "vercel_project_environment_variable" "avp_policy_store_id" {
  project_id = vercel_project.looper.id
  key        = "AVP_POLICY_STORE_ID"
  value      = module.auth.policy_store_id
  target     = ["production"]
  sensitive  = false
}

resource "vercel_project_environment_variable" "access_grants_table" {
  project_id = vercel_project.looper.id
  key        = "ACCESS_GRANTS_TABLE"
  value      = module.auth.access_grants_table_name
  target     = ["production"]
  sensitive  = false
}
