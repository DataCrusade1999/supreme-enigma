# --- Vercel project + the config/secrets that are identical across production and preview ---

resource "random_password" "cookie_secret" {
  length  = 32
  special = false
}

resource "vercel_project" "looper" {
  name           = var.project_name
  framework      = "nextjs"
  root_directory = "web"

  # Only build when something the app actually builds from changed. Vercel's
  # contract is inverted from the usual reading: exit 0 skips the build, exit 1
  # issues one — which is exactly what `git diff --quiet` returns for "no
  # differences" and "differences", so no wrapper logic is needed. Same
  # hand-rolled `git diff --quiet` as deploy.yml's `changes` job.
  #
  # An allowlist rather than a denylist of lambda/infra/docs: root_directory is
  # "web", and the only other build input is content/ (the git-backed Keystatic
  # blog, which must keep triggering rebuilds). The failure mode to know about
  # is that a *new* top-level directory that becomes build-relevant would
  # silently stop deploying until it is added here.
  #
  # Vercel runs this with the working directory set to root_directory, and git
  # pathspecs resolve relative to the cwd — so a bare `web content` would look
  # for web/web and web/content, never match, always exit 0 and skip every
  # build (#229). The `:(top)` magic prefix anchors each pathspec to the repo
  # root, which holds whatever root_directory is set to.
  #
  # This also makes Instant Rollback usable. On Hobby it only reaches the
  # immediately previous production deployment, and the release job pushes a
  # CHANGELOG-only commit to main right after each promotion merge — without
  # this, that commit is its own deployment and the single rollback step
  # reverts a markdown heading instead of the release.
  ignore_command = "git diff --quiet HEAD^ HEAD -- ':(top)web' ':(top)content'"

  # The resume publish route refuses to run unless VERCEL_ENV is "production" or
  # "preview", and VERCEL_ENV is a Vercel system variable. The provider
  # defaults this to false, which leaves system variables unexposed at runtime —
  # the gate would then read undefined and refuse everywhere, so the resume
  # could never be published. Explicit here rather than left to the
  # default, because the route's behaviour depends on it.
  automatically_expose_system_environment_variables = true

  git_repository = {
    type              = "github"
    repo              = var.github_repo
    production_branch = "main"
  }

  # Team mode puts the account slug in the iss claim, which is what
  # aws_iam_openid_connect_provider.vercel's URL is registered as. Global mode would
  # issue a slugless iss that no longer matches the provider.
  oidc_token_config = { issuer_mode = "team" }

  # Preview deployments (dev/stage) are publicly reachable. The AWS DevOps Agent's
  # UI release testing cannot get through Vercel Authentication: it navigates to
  # sub-paths directly, so the bypass token in the test profile's query string is
  # never carried over, and the plan-generation step truncates the token when the
  # agent tries to re-add it itself. Execution 6d2c9593 blocked 12/12 test cases
  # on this. The gated parts of the app (/tools/bgm-looper, /api/looper,
  # /keystatic) are protected by APP_PASSWORD in web/lib/route-gate.ts regardless,
  # so this exposes only the public portfolio pages, which are already public on
  # production.
  vercel_authentication = { deployment_type = "none" }
}

# Bought through Vercel on 2026-09-28, so it lives in the same team and Vercel
# runs its DNS. No git_branch, so it serves production (main).
# bgm-looper.vercel.app keeps working alongside it.
resource "vercel_project_domain" "custom" {
  project_id = vercel_project.looper.id
  domain     = "ashutosh-pandey.com"
}

resource "vercel_project_domain" "custom_www" {
  project_id           = vercel_project.looper.id
  domain               = "www.ashutosh-pandey.com"
  redirect             = vercel_project_domain.custom.domain
  redirect_status_code = 308
}

# Branch domains: each serves the latest deployment of its branch, so they pick
# up the same git_branch-scoped env vars (bucket, Lambda) as the vercel.app
# branch URLs. Previews have no Vercel Authentication (see above), so these
# are public; the tools stay behind APP_PASSWORD.
resource "vercel_project_domain" "custom_branch" {
  for_each   = toset(["dev", "stage"])
  project_id = vercel_project.looper.id
  domain     = "${each.key}.${vercel_project_domain.custom.domain}"
  git_branch = each.key
}

# --- Firewall ---

# No custom rules. The "Rate limit login" rule (#137) was removed in #306: it
# matched /api/login, which #294 deleted when sign-in moved to Cognito, so it
# never fired. Vercel's API also now refuses this provider's full-config PUT
# whenever it contains a rate-limit rule ("Rate limiting is not available for
# this plan" on Hobby), although the dashboard can still edit one. Adding a
# rate-limit rule here would make every apply of this resource fail.
resource "vercel_firewall_config" "looper" {
  project_id = vercel_project.looper.id

  # Both were switched on in the dashboard on 2026-09-30 and adopted here (#306).
  # ai_bots enforces /robots.txt's AI-crawler ban at the edge. bot_protection
  # challenges non-browser clients (curl, uptime checks, unverified preview
  # fetchers get a 429 with x-vercel-mitigated: challenge); Vercel-verified bots
  # such as search crawlers pass. Declare both: the provider PUTs the whole
  # config, so a ruleset left out here is switched off by the next apply.
  managed_rulesets {
    ai_bots {
      action = "deny"
      active = true
    }
    bot_protection {
      action = "challenge"
      active = true
    }
  }
}

locals {
  env_targets = ["production", "preview"]
}

resource "vercel_project_environment_variable" "app_password" {
  project_id = vercel_project.looper.id
  key        = "APP_PASSWORD"
  value      = var.app_password
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "cookie_secret" {
  project_id = vercel_project.looper.id
  key        = "COOKIE_SECRET"
  value      = random_password.cookie_secret.result
  target     = local.env_targets
  sensitive  = true
}

# APP_AWS_ROLE_ARN, not AWS_ROLE_ARN. The AWS SDK's default credential chain reads
# AWS_ROLE_ARN itself and would try web-identity resolution from a token file that does
# not exist on Vercel. Same collision APP_AWS_REGION exists to avoid.
#
# This is now the app's only credential source — there is no AWS_ACCESS_KEY_ID to fall
# back to. awsCredentials() in web/lib/aws.ts still treats the variable as optional, which
# is what keeps the unit tests and local `npm run dev` working on their own static keys.
resource "vercel_project_environment_variable" "aws_role_arn" {
  project_id = vercel_project.looper.id
  key        = "APP_AWS_ROLE_ARN"
  value      = aws_iam_role.vercel.arn
  target     = ["production"]
  sensitive  = false
}

resource "vercel_project_environment_variable" "aws_region" {
  project_id = vercel_project.looper.id
  key        = "APP_AWS_REGION"
  value      = var.aws_region
  target     = local.env_targets
  sensitive  = false
}

# Production only: dev and stage previews take their resume bucket from the nonprod
# env stacks. See the design spec §4.1.
resource "vercel_project_environment_variable" "resume_bucket_name" {
  project_id = vercel_project.looper.id
  key        = "RESUME_BUCKET_NAME"
  value      = local.data_bucket_names["main"]
  target     = ["production"]
  sensitive  = false
}

resource "vercel_project_environment_variable" "openrouter_api_key" {
  project_id = vercel_project.looper.id
  key        = "OPENROUTER_API_KEY"
  value      = var.openrouter_api_key
  target     = local.env_targets
  sensitive  = true
}

resource "vercel_project_environment_variable" "openrouter_model" {
  project_id = vercel_project.looper.id
  key        = "OPENROUTER_MODEL"
  value      = var.openrouter_model
  target     = local.env_targets
  sensitive  = false
}

# Kept as config so the extract route can be pointed at any OpenAI-compatible
# endpoint without a code change — see the design spec §5.2.
resource "vercel_project_environment_variable" "openrouter_base_url" {
  project_id = vercel_project.looper.id
  key        = "OPENROUTER_BASE_URL"
  value      = "https://openrouter.ai/api/v1"
  target     = local.env_targets
  sensitive  = false
}

resource "vercel_project_environment_variable" "news_desk_model" {
  project_id = vercel_project.looper.id
  key        = "NEWS_DESK_MODEL"
  value      = var.news_desk_model
  target     = local.env_targets
  sensitive  = false
}

# Automation bypass token so the AWS DevOps Agent's release testing can reach the
# stage preview URL without disabling Vercel Authentication for every preview.
# Passed as the x-vercel-protection-bypass query param on the test profile URL.
resource "vercel_project_protection_bypass" "automation" {
  project_id = vercel_project.looper.id
  note       = "AWS DevOps Agent release testing"
}
