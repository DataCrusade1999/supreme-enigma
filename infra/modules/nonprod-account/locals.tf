# The base of one nonprod account (dev 624586968135 or stage 792682047320): OIDC
# providers and roles, the ECR repo, the alerts topic, SES and sign-in. Everything here
# lives in the account the caller's provider points at and trusts nothing outside it
# (spec 2026-10-17-nonprod-accounts-design.md §4.1). The bucket, Lambda, exec role and
# alarm come from infra/modules/app, called from the app stack beside this one.
# Values used across this module's files.

data "aws_caller_identity" "current" {}

locals {
  # Control Tower denies every other region.
  region     = "us-east-1"
  account_id = data.aws_caller_identity.current.account_id

  # The branch domain, e.g. dev.ashutosh-pandey.com. The SES identity and the auth
  # domain sit under it.
  site_host = "${var.env}.${var.dns_domain}"

  lambda_function_arn = "arn:aws:lambda:${local.region}:${local.account_id}:function:${var.project_name}-processor-${var.env}"

  # This environment's hosts only. localhost (npm run dev) signs in against dev.
  login_callback_urls = concat(
    [
      "https://${local.site_host}/api/auth/callback",
      "https://${var.project_name}-git-${var.env}-${var.vercel_team_slug}.vercel.app/api/auth/callback",
    ],
    var.env == "dev" ? ["http://localhost:3000/api/auth/callback"] : [],
  )
}
