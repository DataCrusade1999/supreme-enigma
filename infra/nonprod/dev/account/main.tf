# The dev account's base (624586968135): OIDC providers and CI roles, the ECR repo,
# the alerts topic, SES and sign-in. Apply this before the dev env stack, which reads
# its outputs.
module "account" {
  source = "../../../modules/nonprod-account"

  env          = "dev"
  project_name = "bgm-looper"

  # GitHub issues an *immutable* subject for this repo — GET
  # /repos/DataCrusade1999/supreme-enigma/actions/oidc/customization/sub returns
  # use_default: true, use_immutable_subject: true, and this exact sub_claim_prefix.
  # The sub therefore carries numeric owner and repo IDs rather than the plain names,
  # and the name-only form `repo:DataCrusade1999/supreme-enigma:...` is never issued, so
  # a trust policy written against it can never match. Copied verbatim from that API
  # response, like infra/shared's; do not rebuild it from the repo name.
  github_sub_prefix = "repo:DataCrusade1999@57610394/supreme-enigma@1313947304"

  # Vercel account slug, the personal Hobby scope. It appears in the OIDC issuer URL,
  # the aud claim and the sub claim, so it is not cosmetic.
  vercel_team_slug = "ashutosh-pandeys-projects-77cb3a00"
  # The same scope's ID. The domains API answers 403 for ashutosh-pandey.com without it.
  vercel_team_id = "team_bSWug4zpM7jfChbYKg7G4PMI"
  # A known string, not a lookup: this stack never reads production's state (spec §3).
  dns_domain = "ashutosh-pandey.com"

  alert_email          = var.alert_email
  google_client_id     = var.google_client_id
  google_client_secret = var.google_client_secret
  webauthn_enabled     = var.webauthn_enabled
}
