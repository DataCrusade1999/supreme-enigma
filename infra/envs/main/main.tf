# The main (production) environment: its bucket, Lambda, alarm and Vercel env vars.
# Apply infra/shared first on a fresh build — this stack looks up its resources by name.
module "environment" {
  source = "../../modules/environment"

  env           = "main"
  project_name  = var.project_name
  vercel_target = ["production"]

  # Only read when the function is first created; see the module's variable comment.
  bootstrap_image_tag = "main-a61a6a20eb4f0f84b6cf292d25a0d0b5046f8f2e"
}
