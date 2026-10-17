# Fine-grained access to /tools (spec 2026-09-29-access-control-design.md).
# Verified Permissions decides every gated request from the Cedar files under
# infra/modules/auth/cedar/, with the Cognito user pool as its identity source.
# The store is in module.auth (auth.tf); this file grants production's Vercel role
# use of it. Dev and stage have their own stores, in their own accounts.

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
