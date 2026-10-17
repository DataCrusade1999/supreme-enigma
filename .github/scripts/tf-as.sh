#!/usr/bin/env bash
# Runs a command with the AWS credentials of one stack's role, assumed through the
# job's GitHub OIDC token (the job needs `id-token: write`). One session per call,
# because the token is short-lived and each terraform process would otherwise
# assume again. The role comes from tf-stacks.sh; nothing here is printed. The mask
# commands go to stderr: stdout belongs to the wrapped command (`terraform show -json`).
# Usage: tf-as.sh <stack> <plan|apply> <command...>
set -euo pipefail
stack=$1
mode=$2
arn=$(bash "$(dirname "$0")/tf-stacks.sh" role "$stack" "$mode")

token=$(curl -sS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" | jq -r .value)
echo "::add-mask::$token" >&2
creds=$(aws sts assume-role-with-web-identity --role-arn "$arn" \
  --role-session-name "gha-${GITHUB_RUN_ID}-${stack//\//-}" \
  --web-identity-token "$token" --duration-seconds 3600 \
  --query Credentials --output json)

AWS_ACCESS_KEY_ID=$(jq -r .AccessKeyId <<<"$creds")
AWS_SECRET_ACCESS_KEY=$(jq -r .SecretAccessKey <<<"$creds")
AWS_SESSION_TOKEN=$(jq -r .SessionToken <<<"$creds")
echo "::add-mask::$AWS_ACCESS_KEY_ID" >&2
echo "::add-mask::$AWS_SECRET_ACCESS_KEY" >&2
echo "::add-mask::$AWS_SESSION_TOKEN" >&2
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_REGION=us-east-1
unset AWS_PROFILE AWS_ROLE_ARN
exec "${@:3}"
