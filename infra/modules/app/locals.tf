# Everything that exists once per branch: the branch's data bucket, Lambda function and
# its exec role, its invocation alarm, the two Vercel env vars that point the app at
# them, and what the branch's deployments may do on their Vercel role. Shared resources
# (ECR, the Vercel roles, the Vercel project) live in infra/prod/account and are found here
# by name, so this stack never reads prod/account's state.
# Values used across this module's files.

data "aws_caller_identity" "current" {}

locals {
  # Must stay in step with local.env_suffix in infra/prod/account/locals.tf, which builds
  # the same names for the IAM policies and RESUME_BUCKET_NAME.
  suffix               = var.env == "main" ? "" : "-${var.env}"
  lambda_function_name = "${var.project_name}-processor${local.suffix}"

  # The three deployment origins that issue presigned-URL uploads. Wildcard origins were
  # not an authorization hole (the signature grants access, not CORS) but there is no
  # reason for any other site's JS to be able to read these responses.
  #
  # Each list is exhaustive and deliberately has no wildcard: these origins are the
  # only places a browser upload works. A one-off feature-branch preview
  # (bgm-looper-git-<branch>-….vercel.app), a team alias, or a dev server on a port other
  # than 3000 will fail the PUT with an opaque browser CORS error — that is accepted, not
  # an oversight. S3 permits one `*` per entry, so `https://bgm-looper-*.vercel.app` is
  # the one-line change if branch previews ever need to upload.
  app_origins = {
    main = [
      "https://ashutosh-pandey.com",
      "https://bgm-looper.vercel.app",
      "http://localhost:3000",
    ]
    dev = [
      "https://dev.ashutosh-pandey.com",
      "https://bgm-looper-git-dev-ashutosh-pandeys-projects-77cb3a00.vercel.app",
      "http://localhost:3000",
    ]
    stage = [
      "https://stage.ashutosh-pandey.com",
      "https://bgm-looper-git-stage-ashutosh-pandeys-projects-77cb3a00.vercel.app",
      "http://localhost:3000",
    ]
  }
}
