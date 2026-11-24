# Runbook — testing access emails on dev and stage

## When to use this

You changed an Access email (welcome, update, ended) or how it is sent, and
want to see the real email arrive from dev or stage before the change reaches
production.

## How sending works outside production

- Dev (`624586968135`) and stage (`792682047320`) are in the **SES sandbox**.
  SES delivers only to addresses verified in that same account, and a
  verification in dev does not carry over to stage.
- Emails go out from `access@dev.ashutosh-pandey.com` or
  `access@stage.ashutosh-pandey.com` (`ACCESS_FROM_EMAIL`, #530), and link to
  that environment's own site (#541).
- The preview role may send from that one address to any identity in the
  account (`SendAccessEmail` in `infra/modules/nonprod-account/oidc-roles.tf`,
  #540). In the sandbox SES checks the recipient's identity against IAM too,
  which is why the grant covers `identity/*`.
- **Test addresses are added and removed with the AWS CLI, never in
  Terraform.** The one identity Terraform owns besides the domain is the
  owner's address (`aws_sesv2_email_identity.owner`), which Cognito's sign-in
  codes need. Don't delete it: the next apply recreates it and sends a new
  verification link.
- Replies and SES bounce notices to `access@<env>` and `no-reply@<env>` land in
  the owner's Zoho inbox. Both are Zoho aliases of the owner's mailbox (#542).
- A test address that bounces or complains goes on the account's suppression
  list and receives nothing more from that environment. Check it with
  `aws sesv2 get-suppressed-destination --email-address "$ADDR" --profile "$RO" --region us-east-1`,
  and remove it with
  `aws sesv2 delete-suppressed-destination --email-address "$ADDR" --profile "$PROFILE" --region us-east-1`.

## Prerequisites

- Shared prerequisites in [README.md](README.md#shared-prerequisites).
- A Google account you control, not the owner's, as the test inbox (step 2
  says why it must be Google). The Access page
  refuses any change to the owner, so the owner can't grant to themselves.
- The owner signed in on the environment, to use `/tools/access-admin`.

Set these once per shell. For stage, use `personal-stage`, `personal-stage-ro`
and `stage`.

```bash
ADDR=tester@example.com     # the test inbox
PROFILE=personal-dev        # changes (verify, delete)
RO=personal-dev-ro          # reads
ENV=dev
```

## 1. Verify the test address

```bash
aws sesv2 create-email-identity --email-identity "$ADDR" \
  --profile "$PROFILE" --region us-east-1
```

SES emails a link ("Email Address Verification Request") to the address.
Click it, then check:

```bash
aws sesv2 get-email-identity --email-identity "$ADDR" \
  --profile "$RO" --region us-east-1 --query VerifiedForSendingStatus
```

`true` means it can receive. The link expires after 24 hours; if it does,
delete the identity and create it again.

## 2. Make the test account a member

1. Sign in at `https://$ENV.ashutosh-pandey.com/tools` with **Google**, using
   the test address. It lands on "Access requested" and shows up as Pending on
   the Access page. The email-code option can't create a new account: the
   pool sets `allow_admin_create_user_only = true` (`infra/modules/auth/main.tf`),
   so only Google sign-in adds a user to it. A test inbox therefore has to be a
   Google account.
2. As the owner, open `https://$ENV.ashutosh-pandey.com/tools/access-admin`
   and click **Approve**. Approving sends no email.

## 3. Trigger each email

| Action on the Access page | Email |
|---|---|
| **Grant** to a member with no `_welcomed` row | Welcome ("Welcome. <Tool> is ready for you") |
| **Grant** to a member with a `_welcomed` row | Update ("You can now use <Tool>" or "Your access to <Tool> has changed") |
| **Revoke** of an unexpired grant | Ended |
| **Remove** of a member with an unexpired grant | Ended |

The `_welcomed` row is written only when a welcome actually sends, so after a
failed welcome the next grant sends the welcome again, not an update.

The change saves even when the email fails. A failed send shows as
"Saved, but the email failed: …" at the top of the page.

## 4. Check it went through

- **The inbox.** The sender is `Ashutosh Pandey <access@$ENV.ashutosh-pandey.com>`,
  and the buttons and links point at `$ENV.ashutosh-pandey.com`.
- **The welcome marker.** A welcome that sent writes a `_welcomed` row for the
  member, and only then:

  ```bash
  SUB=$(aws cognito-idp list-users --user-pool-id "$(aws cognito-idp list-user-pools \
      --max-results 10 --profile "$RO" --region us-east-1 \
      --query "UserPools[?Name=='bgm-looper-owner'].Id | [0]" --output text)" \
    --filter "email = \"$ADDR\"" --profile "$RO" --region us-east-1 \
    --query 'Users[0].Attributes[?Name==`sub`].Value' --output text)
  aws dynamodb query --table-name site-access-grants \
    --key-condition-expression '#s = :s' --expression-attribute-names '{"#s":"sub"}' \
    --expression-attribute-values "{\":s\":{\"S\":\"$SUB\"}}" \
    --profile "$RO" --region us-east-1 --query 'Items[].action.S' --output text
  ```

  Expect `_welcomed` next to the grant keys.
- **The logs**, when the page showed an error. The deployment URL is on the
  Vercel dashboard, or in the deployment's latest status on GitHub:

  ```bash
  ID=$(gh api "repos/DataCrusade1999/supreme-enigma/deployments?sha=<sha>" --jq '.[0].id')
  gh api "repos/DataCrusade1999/supreme-enigma/deployments/$ID/statuses" --jq '.[0].environment_url'
  ```

  ```bash
  vercel logs --project bgm-looper --deployment <deployment-url> \
    --scope ashutosh-pandeys-projects-77cb3a00 --since 30m --json | grep "email failed"
  ```

### What the errors mean

| Error | Cause | Fix |
|---|---|---|
| `MessageRejected: Email address is not verified` | The test address isn't verified in this account, or the link wasn't clicked | Step 1 |
| `AccessDeniedException … ses:SendEmail on resource …:identity/<addr>` | The preview role's `SendAccessEmail` grant doesn't cover the recipient (#539) | Check the grant still lists `identity/*` |
| `ACCESS_FROM_EMAIL is not set` | The deployment was built before the variable existed | Redeploy the environment's latest deployment with "Use project's Ignore Build Step" unticked |

## 5. Clean up

Remove the member **before** deleting the identity, so the ended email can
still arrive and be checked: click **Remove** for the test account on the
Access page. That deletes its grants and welcome marker and signs it out.
Then:

```bash
aws sesv2 delete-email-identity --email-identity "$ADDR" \
  --profile "$PROFILE" --region us-east-1
aws sesv2 list-email-identities --profile "$RO" --region us-east-1 \
  --query 'EmailIdentities[].IdentityName' --output text
```

The list should show only `$ENV.ashutosh-pandey.com` and the owner's address.
Once the identity is gone, any email to that address fails with
`Email address is not verified`; the Access changes themselves still save.
