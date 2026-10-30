# The production account's (223376380711) base stack: everything there is one of,
# which infra/prod/app and the Vercel project depend on. Dev and stage have their own
# base stacks in their own accounts (infra/<env>/account). Applied from dev only (#345).
# Values used across this stack's files.

locals {
  # GitHub issues an *immutable* subject for this repo — GET
  # /repos/DataCrusade1999/supreme-enigma/actions/oidc/customization/sub returns
  # use_default: true, use_immutable_subject: true, and this exact sub_claim_prefix.
  # The sub therefore carries numeric owner and repo IDs rather than the plain names,
  # and the name-only form `repo:${var.github_repo}:...` is never issued, so a trust
  # policy written against it can never match. Copied verbatim from that API response;
  # do not rebuild it out of var.github_repo.
  github_sub_prefix = "repo:DataCrusade1999@57610394/supreme-enigma@1313947304"

  # Vercel account slug, the personal Hobby scope. It appears in the OIDC issuer URL,
  # the aud claim and the sub claim, so it is not cosmetic. Read off any deployment
  # inspector URL (vercel.com/<slug>/bgm-looper/...) — `list_teams` returns [] on a
  # personal scope, but OIDC still keys on the slug.
  vercel_team_slug = "ashutosh-pandeys-projects-77cb3a00"

  # The same scope's ID. The provider sets no team, and project calls resolve
  # through the token's default team, but the domains API does not: without an
  # explicit teamId it answers 403 for ashutosh-pandey.com.
  vercel_team_id = "team_bSWug4zpM7jfChbYKg7G4PMI"

  # Per-environment names, built from the same rule as infra/modules/app so
  # this stack never reads an env stack's state. Only main is in this account: dev
  # and stage live in their own (nonprod-accounts spec).
  env_suffix = { main = "" }

  lambda_function_names = { for e, s in local.env_suffix : e => "${var.project_name}-processor${s}" }
  data_bucket_names     = { for e, s in local.env_suffix : e => "portfolio-data${s}-${data.aws_caller_identity.current.account_id}" }

  all_lambda_function_arns = [
    for e in keys(local.env_suffix) :
    "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.lambda_function_names[e]}"
  ]
}
