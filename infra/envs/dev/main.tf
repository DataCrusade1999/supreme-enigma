# The dev environment: its bucket, Lambda, alarm and Vercel env vars.
# Apply infra/shared first on a fresh build — this stack looks up its resources by name.
module "environment" {
  source = "../../modules/environment"

  env           = "dev"
  project_name  = var.project_name
  vercel_target = ["preview"]

  # Only read when the function is first created; see the module's variable comment.
  bootstrap_image_tag = "dev-bdf04bfd483a13b26cb30e6a89dacc5d14101e4a"
}
