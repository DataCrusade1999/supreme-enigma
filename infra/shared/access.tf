# Fine-grained access to /tools (spec 2026-09-29-access-control-design.md).
# Verified Permissions decides every gated request from the Cedar files under
# cedar/, with the Cognito user pool as its identity source. Shared by all three
# branches, like the pool: a person's access doesn't depend on the environment.

resource "aws_verifiedpermissions_policy_store" "site" {
  description = "Access to the /tools namespace"

  validation_settings {
    mode = "STRICT"
  }
}

resource "aws_verifiedpermissions_schema" "site" {
  policy_store_id = aws_verifiedpermissions_policy_store.site.id

  definition {
    value = jsonencode(jsondecode(file("${path.module}/cedar/schema.cedarschema.json")))
  }
}

# One resource per file, named by the file. Group entity IDs carry the pool ID
# ("<pool>|owner"), which the files write as ${pool}.
resource "aws_verifiedpermissions_policy" "site" {
  for_each        = fileset("${path.module}/cedar/policies", "*.cedar")
  policy_store_id = aws_verifiedpermissions_policy_store.site.id

  definition {
    static {
      description = trimsuffix(each.value, ".cedar")
      statement   = templatefile("${path.module}/cedar/policies/${each.value}", { pool = aws_cognito_user_pool.owner.id })
    }
  }

  # STRICT checks each policy against the schema, so the schema has to exist first.
  depends_on = [aws_verifiedpermissions_schema.site]
}

# ID tokens from the web client become Site::User "<pool>|<sub>", and their
# cognito:groups become Site::Group parents.
resource "aws_verifiedpermissions_identity_source" "cognito" {
  policy_store_id       = aws_verifiedpermissions_policy_store.site.id
  principal_entity_type = "Site::User"

  configuration {
    cognito_user_pool_configuration {
      user_pool_arn = aws_cognito_user_pool.owner.arn
      client_ids    = [aws_cognito_user_pool_client.web.id]

      group_configuration {
        group_entity_type = "Site::Group"
      }
    }
  }

  depends_on = [aws_verifiedpermissions_schema.site]
}

resource "aws_cognito_user_group" "owner" {
  name         = "owner"
  user_pool_id = aws_cognito_user_pool.owner.id
  description  = "Everything, including the owner-only tools"
}

resource "aws_cognito_user_group" "friends" {
  name         = "friends"
  user_pool_id = aws_cognito_user_pool.owner.id
  description  = "The shareable tools' free actions; metered actions need a grant"
}

# The pool uses email as the username alias, so the email identifies the owner
# to the admin API even though Cognito stores a UUID as the username.
resource "aws_cognito_user_in_group" "owner" {
  user_pool_id = aws_cognito_user_pool.owner.id
  group_name   = aws_cognito_user_group.owner.name
  username     = aws_cognito_user.owner.username
}

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
      Resource = [aws_verifiedpermissions_policy_store.site.arn]
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
  value      = aws_verifiedpermissions_policy_store.site.id
  target     = local.env_targets
  sensitive  = false
}
