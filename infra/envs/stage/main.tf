# The stage environment: its bucket, Lambda, alarm and Vercel env vars.
# Apply infra/shared first on a fresh build — this stack looks up its resources by name.
module "environment" {
  source = "../../modules/environment"

  env               = "stage"
  project_name      = var.project_name
  vercel_target     = ["preview"]
  vercel_git_branch = "stage"

  # Only read when the function is first created; see the module's variable comment.
  bootstrap_image_tag = "stage-0139b7ba435c89c79dc8c88bf6feb79f628753bb"
}
