# The stage environment in the stage account (792682047320): its bucket, Lambda, alarm,
# resume grant and preview Vercel vars. Apply infra/nonprod/stage/account first; this
# stack reads its outputs and finds its Vercel role, ECR repo and alerts topic by name.

# The account stack's state, in the same account's bucket. No profile here: it reads
# the same credentials as the backend, AWS_PROFILE=personal-stage locally, OIDC in CI.
data "terraform_remote_state" "account" {
  backend = "s3"

  config = {
    bucket = "bgm-looper-tf-state-792682047320"
    key    = "account/terraform.tfstate"
    region = "us-east-1"
  }
}

module "env" {
  source = "../../../modules/nonprod-env"

  env               = "stage"
  project_name      = "bgm-looper"
  vercel_git_branch = "stage"

  vercel_role_arn      = data.terraform_remote_state.account.outputs.vercel_role_arn
  cognito_user_pool_id = data.terraform_remote_state.account.outputs.cognito_user_pool_id
  cognito_client_id    = data.terraform_remote_state.account.outputs.cognito_client_id
  cognito_domain_url   = data.terraform_remote_state.account.outputs.cognito_domain_url
  avp_policy_store_id  = data.terraform_remote_state.account.outputs.avp_policy_store_id

  # Only read when the function is first created; see the module's variable comment.
  # A placeholder: Task 12 of the nonprod-accounts plan replaces it with a tag stage's
  # CI has actually pushed to this account's ECR, before the first apply.
  bootstrap_image_tag = "stage-37f1cf03846f10993c2fc7516e47e1d8e8b1664b"
}
