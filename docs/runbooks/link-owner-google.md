# Link the owner's Google sign-in to the owner user

The Cognito pool has one native owner user, created by Terraform and in the `owner` group. Signing in with Google creates a second, separate user (`Google_<id>`) that is in no group, so it lands on "Access requested". Linking makes Google sign in as the native user.

A passkey registered to the Google user is lost when it is deleted in step 2. Register it again afterwards from the hub.

1. Sign in once at https://ashutosh-pandey.com/login with Google. You'll see "Access requested".
2. Find and delete the Google user:

   ```bash
   POOL=us-east-1_TagY3QxyT
   aws cognito-idp list-users --user-pool-id $POOL --filter 'username ^= "Google_"' \
     --profile personal --region us-east-1 --query 'Users[].Username'
   # -> ["Google_1234567890"]
   aws cognito-idp admin-delete-user --user-pool-id $POOL --username Google_1234567890 \
     --profile personal --region us-east-1
   ```

3. Link the Google identity to the native owner user (`<email>` is `alert_email` in `infra/shared/terraform.tfvars`; `<id>` is the number after `Google_`):

   ```bash
   aws cognito-idp admin-link-provider-for-user --user-pool-id $POOL \
     --destination-user ProviderName=Cognito,ProviderAttributeValue=<email> \
     --source-user ProviderName=Google,ProviderAttributeName=Cognito_Subject,ProviderAttributeValue=<id> \
     --profile personal --region us-east-1
   ```

4. Sign in with Google again. You reach the hub with every tool listed.
