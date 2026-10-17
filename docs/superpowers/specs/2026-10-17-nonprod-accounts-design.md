# Dev and stage in their own accounts — Design

Parent: `2026-10-02-terraform-ci-design.md` line 20 ("Multi-account (on hold, separate design)"). This is that design.

## 1. Why

All three environments run in 223376380711, the prod account of the personal AWS organization (o-xtcecsov5b). Today only IAM policy keeps dev and stage away from production, and the Terraform-in-CI spec lists the gaps:

- §9: `tf-apply-nonprod` can write any inline policy on `bgm-looper-vercel-preview`, so code merged only to `dev` could grant previews access to production's bucket.
- dev and stage share production's Cognito pool, Verified Permissions store and resume bucket. A dev deployment can rewrite the live resume.

The org already created the accounts this design moves into: dev 624586968135 and stage 792682047320, both in the NonProd OU. They have SSO access (AdministratorAccess, ReadOnlyAccess) and $2/month budgets from the aws-org repo. The account boundary replaces policy as the thing that keeps nonprod out of prod.

## 2. Goals, non-goals, anti-goals

Goals:
- Every AWS resource dev uses lives in 624586968135. Every one stage uses lives in 792682047320. Nothing in either account can read or write anything in 223376380711, and nothing in prod trusts them.
- dev and stage each have their own sign-in (Cognito pool, custom domain, Google IdP), Verified Permissions store and resume.
- Previews can publish a resume to their own environment's bucket.
- CI reaches each account only from that account's branch.
- After the move, 223376380711 holds production only.

Non-goals (decided; do not add them):
- Separating dev from stage on the Vercel side. Vercel's OIDC subject has only `production` and `preview`, so the dev and stage roles both trust the preview subject. They are kept apart only by which role ARN each branch is configured with (per-env IAM spec §6). The owner accepted this.
- Adding dev and stage to the AWS DevOps Agent Space. It keeps monitoring 223376380711 only.
- Fixing the account-wide Vercel API token (Terraform-in-CI spec §9). A nonprod apply can still edit production's Vercel settings.
- Build-once-and-promote images. Every branch keeps building its own image.
- Migrating any data. dev and stage are rebuilt empty.

Anti-goals (failure even if everything else works):
- Production sign-in, the live resume, production email or the production Lambda breaking at any point.
- A plan against 223376380711 that destroys or replaces a production resource. Removing dev/stage resources and grants from prod is expected; replacing prod's Cognito pool, user pool client, SES identity, policy store or roles is not.
- Any cross-account trust or resource policy between nonprod and prod.
- New recurring cost beyond cents. No customer-managed KMS keys ($1/month each), no Secrets Manager ($0.40/secret), no second CloudTrail in the new accounts (the Control Tower org trail already covers them; a second trail is billed), no AWS Config (off in the landing zone).

## 3. Decisions

| Question | Decision | Whose |
|---|---|---|
| Migrate data? | No. dev and stage are rebuilt from scratch. | Owner |
| Sign-in | Own Cognito pool per account, with its own custom domain `auth.dev.ashutosh-pandey.com` / `auth.stage.ashutosh-pandey.com`, its own ACM cert (us-east-1, in that account), Google IdP, owner user and groups. | Owner (separation), mine (names) |
| Authorization | Own Verified Permissions store per account, same schema and Cedar policies as prod's. | Owner |
| Resume | Each environment's resume lives in its own data bucket. The publish route accepts `VERCEL_ENV` `production` or `preview` (today production only, `web/app/api/resume/publish/route.ts:18-23`). The "draft on dev, publish from prod" flow ends. Production drafts and publishes on production. | Owner |
| Email | SES in sandbox in each new account, with the owner's address verified as a recipient. Production access stays in prod only. Cognito email OTP keeps using SES (`DEVELOPER` mode) in each account. | Owner |
| Shared preview token | Accepted (non-goal above). | Owner |
| OIDC | Each new account gets its own GitHub (`token.actions.githubusercontent.com`) and Vercel (`oidc.vercel.com/ashutosh-pandeys-projects-77cb3a00`) providers. One provider per issuer per account. | Mine |
| CI roles | Each new account gets its own plan, apply and image-deploy roles. Apply and deploy trust only that account's branch ref (`dev` or `stage`), with `StringEquals` on the immutable subject (`shared.tf` `github_sub_prefix`). Plan trusts `pull_request` plus the `dev` ref (drift runs from dev), like prod's. | Mine |
| Apply-role scope in nonprod | Broad within its own account (the account is the blast radius). The deny-iam-users SCP still applies. The workflow's destroy guard (confirm `apply-destroys`) stays. | Mine |
| Terraform state | One state bucket per account, `bgm-looper-tf-state-<account id>`, created by `infra/bootstrap` applied locally per account. Each env stack's backend points at its own account's bucket. | Mine |
| Image repo | One ECR repo `bgm-looper-lambda` per account, same lifecycle shape (untagged after 1 day, keep 1 per prefix). No cross-account pulls. Costs no extra Actions minutes: each branch already builds its own image. | Mine |
| Alerts | Each account gets its own `bgm-looper-budget-alerts` SNS topic for its invocation alarm, email-subscribed to the owner (confirm by hand). No per-project $5 budget in nonprod: the org's $2 account budgets cover it. | Mine |
| Local access | SSO profiles `personal-dev` and `personal-stage` in `~/.aws/config`, on the existing `personal-org` SSO session, AdministratorAccess. | Mine |
| Region | us-east-1 only (Control Tower region deny). | Fixed |
| Stack layout and old state | The new per-account stacks are new directories (e.g. `infra/nonprod/dev`, `infra/nonprod/stage`) with backends in their own account. The existing `infra/envs/dev` and `infra/envs/stage` keep their prod-account backends and code unchanged until their environment's cutover. They are then destroyed with a local `terraform destroy` as `personal`, and their directories and CI routing are deleted. No `moved`, import or `state rm` between accounts. | Mine |
| Vercel lookups from nonprod | Nonprod stacks never read prod's Terraform state. They find the Vercel project with `data "vercel_project"` by name (as the module already does) and use the domain as a known string (`ashutosh-pandey.com`). | Mine |
| Vercel key ownership | `shared`: production-target values, plus the env-agnostic `APP_PASSWORD`, `COOKIE_SECRET`, OpenRouter, `NEWS_DESK_MODEL` and `APP_AWS_REGION`. dev stack: the bare `preview` values of `S3_BUCKET_NAME`, `LAMBDA_FUNCTION_NAME`, `APP_AWS_ROLE_ARN`, `RESUME_BUCKET_NAME`, `AVP_POLICY_STORE_ID` and the three `COGNITO_*`. stage stack: the same keys with `git_branch = "stage"`. | Mine |
| Feature-branch previews | Same as today: sign-in works only on the branch hosts (`dev.`, `stage.`, their `bgm-looper-git-<branch>` URLs) and localhost. Other feature-branch previews get dev's values but no callback URL. | Mine (keeps today's behaviour) |
| Image-deploy role | Same inline policy shape as prod's `ci_deploy` (ECR push on its own repo, `UpdateFunctionCode`/`GetFunction` on its own function), trusted by its own branch only. | Mine |

## 4. What exists afterwards

### 4.1 Each nonprod account (624586968135 dev, 792682047320 stage)

- Terraform state bucket (bootstrap).
- GitHub and Vercel OIDC providers.
- CI roles: plan, apply, image deploy (§3).
- Vercel runtime role, trusted by the `preview` subject, with this environment's grants: today's module statements (`AudioScratchObjects`, `NewsDeskObjects`, `NewsDeskMissingSnapshotIs404`, `InvokeProcessor`), the resume statements (`ResumeObjects`, `ResumeHeadObjectNotFound`) on this environment's bucket, and `IsAuthorizedWithToken` on this account's policy store.
- Everything `infra/modules/environment` creates today: data bucket, Lambda, exec role, invocation alarm. The S3 CORS origins narrow to this environment's hosts plus localhost.
- ECR repo and lifecycle policy.
- SNS alert topic and subscription.
- Cognito: pool, custom domain + ACM cert + Vercel DNS records (`auth.<env>` CNAME, ACM validation), Google IdP, web client (callback URLs: this environment's hosts), managed-login branding, owner user, `owner`/`friends` groups.
- Verified Permissions: store, schema, policies, Cognito identity source.
- SES: a sending identity Cognito can use, its identity policy for `cognito-idp.amazonaws.com`, and the owner's address verified (sandbox).

### 4.2 Production account (223376380711), after cleanup

Removed: the `-dev`/`-stage` buckets, Lambdas, exec roles and alarms; `bgm-looper-vercel-preview` and its policies; `bgm-looper-tf-apply-nonprod`; dev/stage from `ci_deploy`'s trust (main only) and Lambda ARNs; the dev/stage ECR lifecycle rules and images; dev/stage hosts from the Cognito callback URLs; the `envs/dev` and `envs/stage` state objects.

Kept unchanged: the prod Cognito pool, client, domain and Google IdP; the policy store; SES with production access, its DKIM/SPF/DMARC/MAIL FROM records; `bgm-looper-vercel`; `tf-plan`; `tf-apply-prod` (still trusted from `dev` for `shared` and `main` for `envs/main`); the old trail's log bucket (`bgm-looper-cloudtrail-<account>`, emptying on its 365-day expiry); the $5 project budget. CloudTrail and GuardDuty belong to the aws-org repo now.

### 4.3 Vercel (one project, unchanged in shape)

Today the Cognito vars, `AVP_POLICY_STORE_ID`, `RESUME_BUCKET_NAME` and `APP_AWS_ROLE_ARN` (preview) are set in `shared` for `production` + `preview` with no branch. Afterwards:
- `shared` sets them for `production` only.
- Each nonprod environment sets its own values for `preview`, using the pattern `S3_BUCKET_NAME` already uses: dev sets the bare `preview` value, stage overrides with `git_branch = "stage"`. Feature-branch previews therefore get dev's values.
- The project, domains (`dev.`/`stage.` branch domains included), firewall, `APP_PASSWORD`, `COOKIE_SECRET` and OpenRouter vars stay in `shared`.

### 4.4 CI

- `deploy.yml`: the `case` on `github.ref_name` (`:517-521`) also sets the role ARN (that account's deploy role), replacing the hardcoded `:526`. The ECR login and the idempotency check already follow the assumed account's registry.
- `terraform.yml` and `.github/scripts/tf-stacks.*`: the role ARN is chosen per stack by account, replacing `ROLE_PREFIX` (`:36`). PR plans and the weekly drift plan use each account's plan role for that account's stacks.

### 4.5 aws-org repo (separate PR there)

- `security/access-analyzer.tf`: archive rules for the reviewed OIDC roles in dev and stage, built the same way as `looper_oidc_roles` for prod, so a new role trusting those providers still raises a finding.

## 5. Rollout

Order matters. Production must keep working at every step, and stage keeps running on the old prod-account resources until its own cutover.

0. Profiles `personal-dev`, `personal-stage`. Check each new account's Lambda concurrency quota (L-B99A9384) and SES sandbox state.
1. Bootstrap the state bucket in dev and stage (local apply).
2. Code: the per-account stacks, the workflow routing, the publish guard. Merging to `dev` must not change what stage uses yet. Stage today inherits the bare `preview` Vercel values, so before dev's bare values change, add `git_branch = "stage"` overrides that pin stage to its current prod-account values: the three `COGNITO_*`, `AVP_POLICY_STORE_ID`, `RESUME_BUCKET_NAME` and `APP_AWS_ROLE_ARN`. `S3_BUCKET_NAME` and `LAMBDA_FUNCTION_NAME` already have stage overrides. Stage's own cutover replaces them.
3. **dev cutover.** The first apply of the dev account's stack is local as `personal-dev`, in passes:
   1. A targeted apply creates the state-independent base: ECR repo, OIDC providers, CI roles.
   2. A `workflow_dispatch` of `deploy.yml` from `dev` builds and pushes the first `dev-<sha>` image into the new repo.
   3. Set `bootstrap_image_tag` to that tag, then do the full apply.

   Then by hand: add `https://auth.dev.ashutosh-pandey.com/oauth2/idpresponse` to the Google OAuth client, confirm the SNS subscription, verify the owner's address in SES, link the owner user to Google (`docs/runbooks/link-owner-google.md`), register a passkey. The "Cognito WebAuthn on a from-scratch apply" failure in `.claude/rules/infra.md` will happen once per new pool; follow that rule. Switch dev's Vercel vars to the new account. Verify end to end (§6). Destroy the old `-dev` resources in 223376380711; deleting buckets and functions needs a local apply as `personal` (CI's roles deny it).
4. **stage cutover.** Same as step 3 for stage.
5. **Prod cleanup** (§4.2), in `shared` and `envs/main`. The plan must show only removals of dev/stage items and in-place edits (trust, callback URLs, policy lists, Vercel var targets).
6. aws-org PR (§4.5).
7. Docs (§7).

Vercel holds one value per key per target/branch. Where `shared` and an env stack would set the same key for the same target, narrow `shared` first, or the apply fails or leaves two preview values (the same trap as `aws_role_arn_preview`'s `depends_on` in `shared.tf`).

## 6. Done when

For dev and for stage, on its branch domain:
- Sign-in works with Google, email OTP (the email arrives) and a passkey, against that environment's pool.
- A gated route is allowed for the owner group and denied for a signed-out user (Verified Permissions in that account).
- BGM Looper processes a track: the upload, the Lambda invoke and the download all hit that account.
- A resume uploads, extracts and publishes on that environment. `/resume` and `/resume.pdf` serve it. Production's resume is unchanged.
- A push to the branch deploys a new image to that account's ECR and Lambda, and its Terraform applies with that account's role.
- That environment's CloudTrail events (org trail) show no calls into 223376380711.

For production: sign-in, the resume, the Looper and email all still work, and 223376380711 has no `-dev`/`-stage` resources left. The PR plans of steps 3–5 are attached to their PRs.

## 7. Docs to update

The ones the recon found, all naming 223376380711 or the per-env names:
- `docs/runbooks/release-promotion.md:22-24`
- `docs/runbooks/infra-apply-teardown.md:105,167-174`
- `docs/runbooks/incident-tool-down.md:134,150`
- `docs/runbooks/stale-lambda-recovery.md:45`
- `docs/runbooks/README.md:22`
- `ARCHITECTURE.md:32`
- `CLAUDE.md:85` and its Branching section
- `.claude/rules/infra.md:37-38,50,63`

`docs/aws-devops-agent.md:19` should also say that dev and stage are outside the Agent Space. Historical specs and plans are records; leave them.

## 8. Left to the builder

- Module shape inside the new per-account stacks, e.g. one nonprod-account module plus the existing environment module, or one stack or two per account. Constraint: Cognito, Cedar and branding config must not be hand-copied from `infra/shared`. Share it through a module or shared files. If prod's resources move into a module, `moved` blocks must make the prod plan show no replacement.
- Which SES identity each new account verifies (the apex domain again with its own DKIM records, or a subdomain). Constraint: production's DNS records and SES identity stay untouched, and the owner receives the OTP email.
- Where localhost (`npm run dev`) points: my default is the dev pool and dev callback.
- How the bootstrap stack keeps separate local state per account.
- Exact IAM actions of the nonprod apply roles, within §3.
