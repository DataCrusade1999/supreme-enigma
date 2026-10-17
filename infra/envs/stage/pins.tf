# Temporary: removed with this stack in Task 12 of the nonprod-accounts plan.
#
# Pins stage's six preview values to the prod-account values that infra/shared sets on the
# bare `preview` target today. Task 10 narrows shared's values to production; without these
# branch-scoped pins stage would lose them. Same values, so applying this changes nothing at
# runtime.

data "terraform_remote_state" "shared" {
  backend = "s3"

  config = {
    bucket = "bgm-looper-tf-state-223376380711"
    key    = "shared/terraform.tfstate"
    region = "us-east-1"
  }
}

locals {
  stage_preview_pins = {
    APP_AWS_ROLE_ARN     = data.terraform_remote_state.shared.outputs.vercel_preview_role_arn
    RESUME_BUCKET_NAME   = data.terraform_remote_state.shared.outputs.resume_bucket_name
    AVP_POLICY_STORE_ID  = data.terraform_remote_state.shared.outputs.avp_policy_store_id
    COGNITO_DOMAIN       = data.terraform_remote_state.shared.outputs.cognito_domain_url
    COGNITO_CLIENT_ID    = data.terraform_remote_state.shared.outputs.cognito_client_id
    COGNITO_USER_POOL_ID = data.terraform_remote_state.shared.outputs.cognito_user_pool_id
  }
}

resource "vercel_project_environment_variable" "stage_preview_pin" {
  for_each = local.stage_preview_pins

  project_id = data.terraform_remote_state.shared.outputs.vercel_project_id
  key        = each.key
  value      = each.value
  target     = ["preview"]
  git_branch = "stage"
  sensitive  = false
}
