# The dev environment in the dev account (624586968135): its bucket, Lambda, alarm,
# resume grant and preview Vercel vars. Apply infra/nonprod/dev/account first; this
# stack reads its outputs and finds its Vercel role, ECR repo and alerts topic by name.

# The account stack's state, in the same account's bucket. No profile here: it reads
# the same credentials as the backend, AWS_PROFILE=personal-dev locally, OIDC in CI.
data "terraform_remote_state" "account" {
  backend = "s3"

  config = {
    bucket = "bgm-looper-tf-state-624586968135"
    key    = "account/terraform.tfstate"
    region = "us-east-1"
  }
}

module "env" {
  source = "../../../modules/nonprod-env"

  env          = "dev"
  project_name = "bgm-looper"

  vercel_role_arn      = data.terraform_remote_state.account.outputs.vercel_role_arn
  cognito_user_pool_id = data.terraform_remote_state.account.outputs.cognito_user_pool_id
  cognito_client_id    = data.terraform_remote_state.account.outputs.cognito_client_id
  cognito_domain_url   = data.terraform_remote_state.account.outputs.cognito_domain_url
  avp_policy_store_id  = data.terraform_remote_state.account.outputs.avp_policy_store_id

  # Only read when the function is first created; see the module's variable comment.
  # A placeholder: Task 10 of the nonprod-accounts plan replaces it with a tag dev's
  # CI has actually pushed to this account's ECR, before the first apply.
  bootstrap_image_tag = "set-in-task-10"
}
