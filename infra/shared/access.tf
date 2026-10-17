# Fine-grained access to /tools (spec 2026-09-29-access-control-design.md).
# Verified Permissions decides every gated request from the Cedar files under
# infra/modules/auth/cedar/, with the Cognito user pool as its identity source.
# The store is in module.auth (auth.tf); this file grants the Vercel roles use of
# it. Shared by all three branches, like the pool: a person's access doesn't
# depend on the environment.

# Both Vercel roles get the same statements: production assumes aws_iam_role.vercel,
# dev and stage assume aws_iam_role.vercel_preview, and everything here (the policy
# store, later the pool and the grants table) is shared by all three environments.
# Same pattern as vercel_resume_statements in shared.tf.
locals {
  vercel_access_statements = [
    {
      Sid      = "AuthorizeRequests"
      Effect   = "Allow"
      Action   = ["verifiedpermissions:IsAuthorizedWithToken"]
      Resource = [module.auth.policy_store_arn]
    },
  ]
}

resource "aws_iam_role_policy" "vercel_access" {
  name   = "${var.project_name}-vercel-access"
  role   = aws_iam_role.vercel.id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.vercel_access_statements })
}

resource "aws_iam_role_policy" "vercel_preview_access" {
  name   = "${var.project_name}-vercel-preview-access"
  role   = aws_iam_role.vercel_preview.id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.vercel_access_statements })
}

resource "vercel_project_environment_variable" "avp_policy_store_id" {
  project_id = vercel_project.looper.id
  key        = "AVP_POLICY_STORE_ID"
  value      = module.auth.policy_store_id
  target     = local.env_targets
  sensitive  = false
}
