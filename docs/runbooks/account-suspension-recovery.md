# Runbook — recovery after an AWS account suspension

## When to use this

AWS suspended one of the three accounts and has since reinstated it. Getting
the account reinstated happens outside this repo; this runbook starts once the
account is active again.

A suspension can remove resources without leaving a trace in CloudTrail. On
2026-10-29, after dev and stage were suspended for a day, both accounts had
lost their Verified Permissions identity source, with no
`DeleteIdentitySource` event in either account. Terraform state still listed
both. The symptom was every gated page on dev and stage showing "Access can't
be checked right now." after sign-in: the proxy treats the failing
`IsAuthorizedWithToken` call as a deny (`web/lib/authz/`).

| Account | ID | Profile | Stacks | Applied from |
|---|---|---|---|---|
| Production | 223376380711 | `personal` | `shared`, `envs/main` | `dev`, `main` |
| Dev | 624586968135 | `personal-dev` | `nonprod/dev/account`, `nonprod/dev/env` | `dev` |
| Stage | 792682047320 | `personal-stage` | `nonprod/stage/account`, `nonprod/stage/env` | `stage` |

## Prerequisites

- Shared prerequisites in [README.md](README.md#shared-prerequisites).
- `gh` with permission to dispatch workflows.

## Detect

### 1. Plan every stack against the live accounts

```bash
gh workflow run terraform.yml --ref dev -f stack=drift
```

The drift run plans all six stacks from the branches that apply them, and
opens or comments on the issue labelled `drift` with each stack's plan. It
only plans and never applies. Each stack that the suspension touched shows the
missing resources as `will be created`. On 2026-10-29 the whole diff was one
resource per nonprod account:

```
# module.account.module.auth.aws_verifiedpermissions_identity_source.cognito will be created
Plan: 1 to add, 0 to change, 0 to destroy.
```

### 2. Check what the plan cannot see

`No changes` does not cover these:

- **The Lambda image.** `image_uri` is in `ignore_changes`, so a deleted image
  never shows in a plan. Check that the function's tag still exists in ECR:

  ```bash
  FN=bgm-looper-processor-dev    # bgm-looper-processor / -stage
  PROFILE=personal-dev-ro        # personal-ro / personal-stage-ro
  IMG=$(aws lambda get-function --function-name "$FN" \
    --query Code.ImageUri --output text --profile "$PROFILE" --region us-east-1)
  aws ecr describe-images --repository-name bgm-looper-lambda \
    --image-ids imageTag="${IMG##*:}" --profile "$PROFILE" --region us-east-1
  ```

  `ImageNotFoundException` means the image is gone: follow
  [stale-lambda-recovery.md](stale-lambda-recovery.md#fallback--workflow_dispatch)
  to rebuild it. If `get-function` itself fails with
  `ResourceNotFoundException`, the function is gone too, and the drift plan
  shows it as `will be created`; see the Fix section.

- **The alert email subscription.** A plan reports `No changes` for an
  unconfirmed or deleted subscription
  ([infra-apply-teardown.md](infra-apply-teardown.md#verify-the-budget-alarm-can-reach-you)):

  ```bash
  ACCOUNT=624586968135           # 223376380711 / 792682047320
  aws sns get-topic-attributes \
    --topic-arn "arn:aws:sns:us-east-1:$ACCOUNT:bgm-looper-budget-alerts" \
    --profile "$PROFILE" --region us-east-1 \
    --query 'Attributes.{confirmed:SubscriptionsConfirmed,pending:SubscriptionsPending}'
  ```

  `confirmed` should be `1`.

- **Cognito users other than the owner.** Terraform creates only the owner;
  anyone else has to be added again by hand:

  ```bash
  aws cognito-idp list-users --user-pool-id <pool id> \
    --query 'Users[].Attributes[?Name==`email`].Value[]' \
    --profile "$PROFILE" --region us-east-1
  ```

- **Data.** Uploads and outputs expire after a day anyway. The resume under
  `resume/` and the News Desk data in the bucket are not in Terraform. If they
  are missing, republish them from the tools.

## Fix

Apply each stack whose drift plan showed changes, from the branch that owns it:

```bash
gh workflow run terraform.yml --ref dev   -f stack=nonprod/dev/account
gh workflow run terraform.yml --ref stage -f stack=nonprod/stage/account
```

Read the plan first. If it deletes, replaces or forgets anything, the apply
stops at the destroy guard; rerun with `-f confirm=apply-destroys` only if the
plan is what you expect. When CI cannot run, apply locally with
[infra-apply-teardown.md](infra-apply-teardown.md).

**If the Lambda function is gone**, the env stack recreates it from the fixed
`bootstrap_image_tag` in `infra/envs/main/main.tf` or
`infra/nonprod/<env>/env/main.tf`. ECR keeps only the latest image per
branch, so that tag is usually gone too, and the apply fails. In that order:

1. Push an image. `gh workflow run deploy.yml --ref <branch>` builds and pushes
   it, then skips `update-function-code` because the function does not exist
   (on `main` the dispatch also cuts a release; see
   [stale-lambda-recovery.md](stale-lambda-recovery.md#fallback--workflow_dispatch)).
2. Set `bootstrap_image_tag` to the tag it pushed (`aws ecr describe-images
   --repository-name bgm-looper-lambda`). Land the change on the branch,
   through the usual promotion for `stage` and `main`; the push applies the
   env stack.

Recreating the identity source needs no Vercel redeploy: the policy store ID in
`AVP_POLICY_STORE_ID` stays the same. A recreated policy store, Cognito pool or
client would come with new IDs. In a nonprod account the `env` stack copies
them into the Vercel env vars, so apply it after the `account` stack; in
production `shared` sets both. A deployment keeps the values it was built
with, so redeploy the branch afterwards.

## Verify

- Run the drift check again. Every stack should say `No changes`, and the
  run closes the `drift` issue.
- Sign in on the environment and open `/tools`. The hub loads instead of
  "Access can't be checked right now."
- For the identity source specifically:

  ```bash
  aws verifiedpermissions list-policy-stores \
    --profile "$PROFILE" --region us-east-1 --query 'policyStores[].policyStoreId'
  aws verifiedpermissions list-identity-sources --policy-store-id <store id> \
    --profile "$PROFILE" --region us-east-1
  ```

  There should be one source, naming the account's user pool and its `web`
  client.

## Escalation

See [README.md](README.md#escalation).
