# Infra credential & cost hardening — implementation plan

Covers the two `priority: high` findings from
[docs/research/2026-09-15-architecture-review.md](../../research/2026-09-15-architecture-review.md)
(#152) judged worth acting on:

- **#154** — no concurrency ceiling on the Lambdas. **Done**, though not as the issue proposed. Part A.
- **#155** — two permanent IAM access key pairs, no federation anywhere. **B1-B4 shipped
  2026-09-16** (#157, #158, #159, #160, #161); **B5 outstanding.** Part B.

There is no matching design spec. The issues are the spec; this is the plan.

---

## Part A — #154, shipped 2026-09-16 (PR #156, `db35f03`)

### The issue could not be implemented as written

#154 asked for `reserved_concurrent_executions = 2` on `aws_lambda_function.looper` and
`.looper_env`. Checking the live account first is what caught it:

```
$ aws lambda get-account-settings --profile personal --region us-east-1
"ConcurrentExecutions": 10,
"UnreservedConcurrentExecutions": 10

$ aws service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384 ...
"QuotaName": "Concurrent executions", "Value": 10.0, "Adjustable": true
```

This account carries the reduced quota new accounts get; it has never been raised.
[AWS's rule](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html) is
*"You can reserve up to the Unreserved account concurrency value minus 100"* — negative here, so
any non-zero reservation is rejected. Exercised on `bgm-looper-processor-dev`:

```
put-function-concurrency 0  → {"ReservedConcurrentExecutions": 0}
put-function-concurrency 2  → InvalidParameterValueException: Specified
    ReservedConcurrentExecutions for function decreases account's
    UnreservedConcurrentExecution below its minimum value of [10].
```

(Reverted with `delete-function-concurrency` immediately.)

Two consequences. The issue's two lines would have broken `terraform apply` for everything in
`infra/main`, not just Lambda. And the premise was wrong in our favour: the runaway ceiling is
already 10 × 1024MB, roughly **$0.60/hour**, not the unbounded figure implied.

### What shipped instead

The real gap #154 identifies is in its own second paragraph — the $5 budget reports hours after the
money is gone. That is fixable without touching concurrency.

- `aws_cloudwatch_metric_alarm.lambda_invocation_rate` (`infra/main/environments.tf`), one per
  function via `for_each` over the new `local.all_lambda_function_names`. `Invocations` Sum > 50 per
  five minutes to the existing `bgm-looper-budget-alerts` SNS topic.
  - **`Invocations`, not `ConcurrentExecutions`.** Concurrency is already hard-capped at 10, so what
    is unbounded is how many times over that ceiling gets reused. A fast-failing loop burns money at
    high invocation count and low concurrency, which a concurrency alarm never sees.
  - **`treat_missing_data = "notBreaching"` is load-bearing.** Lambda emits no datapoint while idle,
    which is nearly always; without it every alarm sits in `INSUFFICIENT_DATA` forever.
- `aws_sns_topic_policy.budget_alerts` gained a `cloudwatch.amazonaws.com` statement
  (`infra/main/shared.tf`). That resource **replaces** SNS's default topic policy, so a publisher not
  named in it is denied — the alarms would have reached `ALARM` and notified nobody.
- Three alarms, inside CloudWatch's 10-alarm free tier. No cost.

### Verified, not assumed

```
Apply complete! Resources: 3 added, 1 changed, 0 destroyed.
```

All three alarms reached `OK` on their own first evaluation, which is what proves `notBreaching`
works. Delivery was proven end to end rather than inferred, since the topic-policy statement was the
new and untested part — forced `bgm-looper-processor-dev-invocation-rate` to `ALARM`, then:

```
$ aws cloudwatch describe-alarm-history --history-item-type Action ...
"Successfully executed action arn:aws:sns:us-east-1:223376380711:bgm-looper-budget-alerts"
```

Set back to `OK` afterwards. The subscription was confirmed beforehand (`SubscriptionsConfirmed: 1`),
so a successful publish means mail actually went out.

Docs corrected in the same PR: `ARCHITECTURE.md` (worst-case ceiling section),
`docs/runbooks/incident-tool-down.md` (the throttle lever is zero-or-nothing; its drift warning
**stays**, because the attribute is unmanaged so a later apply still plans `0 → -1` and calls
`DeleteFunctionConcurrency`), and `.claude/rules/infra.md`.

---

## Part B — #155, not started

Replace both long-lived IAM access key pairs with OIDC federation. Five PRs, strictly ordered. Only
the last carries `Closes #155`; the earlier four say `Refs #155`, since the keyword fires on merge to
`dev` and would close the issue with work outstanding.

`infra/` has no CI validation, so **every infra PR gets a `terraform plan` against real state before
merge**, per `CLAUDE.md`.

### Facts already confirmed, so nobody re-derives them

- **Vercel account slug is `ashutosh-pandeys-projects-77cb3a00`** — read off the Vercel check URL on
  PR #156. `list_teams` returns `[]`, which is expected for a personal Hobby scope; OIDC still uses
  `owner:<slug>` in the `sub` claim.
- **`aws iam list-open-id-connect-providers` returns `[]`** — both providers are clean creations, no
  `terraform import` needed.
- **Vercel OIDC federation is available on all plans**, including Hobby.
- **`vercel_project.oidc_token_config` in provider 5.15.0 has only `issuer_mode`** — there is no
  `enabled` field. Do not go looking for one.
- **`aws_iam_openid_connect_provider` needs no `thumbprint_list`** — AWS provider 6.63 documents
  GitHub as one of the IdPs validated against AWS's own trusted-root CA library.
- **GitHub's `sub` is the immutable, ID-qualified form, not `repo:<owner>/<repo>:...`.** This repo
  has `use_immutable_subject: true` (GitHub's current default — `use_default: true`), so the sub is
  `repo:DataCrusade1999@57610394/supreme-enigma@1313947304:ref:refs/heads/<branch>`. Read it off
  `gh api repos/DataCrusade1999/supreme-enigma/actions/oidc/customization/sub`, whose
  `sub_claim_prefix` is exactly that string, and copy it verbatim rather than rebuilding it from
  `var.github_repo`. B1 shipped with the name-only form and #158's deploy failed at `Configure AWS
  credentials` with `Not authorized to perform sts:AssumeRoleWithWebIdentity`; the real sub came out
  of CloudTrail's `LookupEvents` on `AssumeRoleWithWebIdentity`, which records it as `userName`.
  That lookup is the diagnostic for any future trust-policy mismatch — the STS error names no claim.
  Fixed in #159.

### B1 — CI role in Terraform (infra only, nothing switches over)

In `infra/main/shared.tf`, beside the existing `ci_deploy` resources, which stay untouched here:

- `aws_iam_openid_connect_provider.github`: `url = "https://token.actions.githubusercontent.com"`,
  `client_id_list = ["sts.amazonaws.com"]`, no thumbprint.
- `aws_iam_role.ci_deploy`: `sts:AssumeRoleWithWebIdentity`, `StringEquals` on both `:aud` =
  `sts.amazonaws.com` **and** `:sub` as an explicit three-entry list:
  ```
  repo:DataCrusade1999@57610394/supreme-enigma@1313947304:ref:refs/heads/main
  repo:DataCrusade1999@57610394/supreme-enigma@1313947304:ref:refs/heads/dev
  repo:DataCrusade1999@57610394/supreme-enigma@1313947304:ref:refs/heads/stage
  ```
  `StringEquals` on a literal list, **not** `StringLike` with a wildcard — a wildcard `sub` lets a
  fork PR's `pull_request` context assume the role. The prefix is the immutable subject described
  above; `var.github_repo` is the wrong source for it.
- `aws_iam_role_policy.ci_deploy`: the three statements from `aws_iam_user_policy.ci_deploy`
  verbatim, same `local.all_lambda_function_arns`. Do not "improve" them while moving.
- New output `ci_deploy_role_arn`.

Apply. Plan must read N creations, zero changes, zero destroys.

### B2 — switch `deploy.yml` to the role

On the `deploy` job only:

```yaml
    permissions:
      id-token: write
      contents: read
```

**`contents: read` is mandatory, not decoration.** The workflow has no `permissions:` block on
`deploy` today, so it inherits the repo default. The moment a block appears it becomes the complete
set, and `actions/checkout@v7` fails without it. The `release` job declares its own and is
unaffected.

Then swap the key inputs for `role-to-assume: arn:aws:iam::223376380711:role/bgm-looper-ci-deploy`.

This PR touches `deploy.yml`, which is in the `changes` job's own watch list, so merging it runs
`deploy` on `dev` for real. **That run is the test.** Leave `AWS_CI_*` in the repo secrets for now,
unreferenced — that is the rollback.

### B3 — Vercel role in Terraform (infra only)

- `aws_iam_openid_connect_provider.vercel`: `url = "https://oidc.vercel.com/<slug>"` (team issuer
  mode), `client_id_list = ["https://vercel.com/<slug>"]`.
- `oidc_token_config = { issuer_mode = "team" }` on `vercel_project.looper`. Confirm it plans as an
  in-place update, not a replacement.
- `aws_iam_role.vercel`: `StringEquals` on `oidc.vercel.com/<slug>:aud` and on `:sub` as a two-entry
  list:
  ```
  owner:<slug>:project:bgm-looper:environment:production
  owner:<slug>:project:bgm-looper:environment:preview
  ```
  Vercel has no per-branch environment — `dev` and `stage` are both `preview`. That grants nothing
  new, since all three branches already share one IAM policy. Note it in a comment so the missing
  `stage` entry does not read as an oversight.
- `aws_iam_role_policy.vercel`: the five statements from `aws_iam_user_policy.vercel` verbatim,
  including the `ResumeHeadObjectNotFound` `s3:ListBucket` statement and its comment, which is
  load-bearing.
- A new `vercel_project_environment_variable` for the role ARN, targets `["production", "preview"]`.

**Name it `APP_AWS_ROLE_ARN`, not `AWS_ROLE_ARN`.** The AWS SDK's default credential chain reads
`AWS_ROLE_ARN` itself and would attempt web-identity resolution from a file that does not exist.
This is the same collision `APP_AWS_REGION` exists to avoid.

### B4 — app reads the role

`cd app && npm i @vercel/oidc-aws-credentials-provider`. Two call sites construct a client:
`app/lib/aws.ts`'s `getS3Client()`, and the inline `LambdaClient` in
`app/app/api/looper/process/route.ts`. One helper in `app/lib/aws.ts`, used by both:

```ts
function credentials() {
  const roleArn = process.env.APP_AWS_ROLE_ARN;
  return roleArn ? { credentials: awsCredentialsProvider({ roleArn }) } : {};
}
```

The conditional is the whole design: with no role ARN it falls through to the SDK's default chain, so
`app/lib/aws.test.ts` (which sets static creds in eight places), `playwright.config.ts`'s self-hosted
server, and local `npm run dev` all keep working untouched. No test changes.

Add a line near `DOWNLOAD_URL_TTL_SECONDS` while here: URLs signed with role credentials embed
`X-Amz-Security-Token` and die with the session. The SDK refreshes at ≤5 min remaining and the TTL is
exactly 300s — raising it later without raising session duration yields URLs that expire early.

**Ordering trap.** Vercel env vars are baked at build time and Terraform adding one does not trigger a
redeploy. This PR touches `app/`, so `dev` rebuilds with the variable present; `stage` and `main` only
get it when the promotion PRs land. Verify a track end to end on **each** of the three environments
before B5. The old static keys are still live, so a missing variable degrades to existing behaviour
rather than breaking — which is exactly why deletion is a separate PR.

### B5 — delete both users (`Closes #155`)

**This is the only step left.** B1-B4 shipped 2026-09-16 — see "What B1-B4 actually verified" below
for what is already proven and what is not.

Only after B4 is verified on all three environments. As of 2026-09-16 it is verified on `dev` only:
`stage` and `main` still run on the static keys, because Vercel bakes env vars at build time and
neither has rebuilt with `APP_AWS_ROLE_ARN` present. **Promote `dev → stage` and `stage → main`
first, then re-run the checks below on each**, and only then open B5.

Remove `aws_iam_user.vercel` / `.ci_deploy`, both `aws_iam_access_key`, both `aws_iam_user_policy`,
and `vercel_project_environment_variable.aws_access_key` / `.aws_secret_key` from `shared.tf`; remove
`vercel_access_key_id`, `ci_deploy_access_key_id`, `ci_deploy_secret_access_key` from `outputs.tf`.
Apply, then delete the two GitHub secrets by hand.

Destroying the Vercel key invalidates the credential baked into older deployments — harmless only
because B4 already landed everywhere. It does mean **Instant Rollback to a pre-B4 production
deployment comes back credential-less.** Say so in the PR body.

Docs to correct in the same PR:

| File | Change |
|---|---|
| `README.md` (bootstrap step 3, teardown) | No longer copies `terraform output` into GitHub secrets; teardown no longer means refreshing `AWS_CI_*` |
| `docs/runbooks/infra-apply-teardown.md` | Same, in both places |
| `ARCHITECTURE.md` | Two IAM users → two federated roles |
| `.claude/rules/infra.md` | The "CI sets neither — it uses env-var credentials only" bullet becomes false |
| `CHANGELOG.md` | An entry per PR, in that PR, by hand |

Re-run the prose grep at implementation time (`ci-deploy|vercel-sa|access key|iam_user` over
`README.md`, `ARCHITECTURE.md`, `docs/runbooks/`, `.claude/`). Leave `docs/superpowers/specs/` and the
older `docs/superpowers/plans/` alone — they are dated records of what was designed then.

### What B1-B4 actually verified, on `dev`, 2026-09-16

Re-run each of these on `stage` and on `main` after promotion. They need no UI: log in via
`POST /api/login` with `app_password` from `infra/main/terraform.tfvars`, keep the cookie, and
substitute that environment's host.

| Grant | Check | Result on `dev` |
|---|---|---|
| CI role, all three policy statements | `gh run rerun <id> --failed` on a lambda-touching commit | `deploy` green; `bgm-looper-processor-dev` on `dev-487b873e…` |
| `AudioScratchObjects` (`PutObject`) | `POST /api/looper/upload-url`, then `PUT` the file | 200; signed URL carries `X-Amz-Security-Token` and an `ASIA…` key id, not `AKIA…` |
| `InvokeProcessor` | `POST /api/looper/process` | 200 with peaks, duration and a download URL |
| `AudioScratchObjects` (`GetObject`) | `GET` the returned download URL | 200, 24049 bytes |
| `ResumeObjects` (`GetObject`, main's bucket) | `GET /api/resume/draft?draftId=<random uuid>` | 404 `no draft for that id` — the `NoSuchKey` path, not a credential error |
| `ResumeHeadObjectNotFound` (`s3:ListBucket`) | `POST /api/resume/extract` with a random `draftId` | 404 `no PDF for that draft`. **This is the load-bearing one**: without `ListBucket`, `HeadObject` on an absent key returns 403, `objectExists()` rethrows, and this is a 500. It also costs nothing — the route returns before any model call. |

**`ResumeDraftCleanup` (`s3:DeleteObject`) is the one grant never exercised, and it cannot be.**
`grep -rn 'DeleteObject' app/` returns nothing — `app/lib/aws.ts` has no delete helper and no route
issues a `DeleteObjectCommand`. The statement was carried into both the user policy and the role with
no caller behind it, so there is no request that would prove it. Nothing to do before B5; flagged
here only so the gap is not mistaken for an untested path. Removing it is separate work from #155.

Both roles' assumption is recorded in CloudTrail with no `errorCode`:
`aws-sdk-js-session-*` on `bgm-looper-vercel`, subject
`owner:ashutosh-pandeys-projects-77cb3a00:project:bgm-looper:environment:preview` — the documented
form, so Vercel's subject needed no correction the way GitHub's did.

### B6 — verification

- `deploy.yml` completes a real `deploy` on `dev` with `AWS_CI_*` absent from repo secrets.
- `aws iam list-access-keys --user-name bgm-looper-ci-deploy --profile personal --region us-east-1`
  returns `NoSuchEntity`; same for `bgm-looper-vercel-sa`.
- `aws iam list-open-id-connect-providers` lists both providers.
- BGM Looper processes a track end to end on `dev`, `stage` and `main`.
- Resume admin **on `dev`**: upload a draft and run the extraction. All branches share main's bucket,
  so this exercises `PutObject`, `DeleteObject` on `resume/drafts/*` and the `ListBucket`-dependent
  `objectExists()` path that 500s if `ResumeHeadObjectNotFound` did not survive the move — with no
  production side effect. Do **not** fold the still-pending production publish into this; that is its
  own deliberate step.
- `cd app && npm test && npm run test:e2e` pass unchanged, which is the point of B4's conditional.

---

## Review coverage note

PR #156 was reviewed by the AWS DevOps Agent alone (`change approved`, no inline findings).
`chatgpt-codex-connector[bot]` posted `You have reached your Codex usage limits for code reviews`
instead of reviewing. `CLAUDE.md` assumes two independent bots review every PR; while that limit
holds, a green verdict covers one of them. Expect the same on B1–B5 and weight your own review
accordingly.
