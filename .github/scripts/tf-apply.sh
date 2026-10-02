#!/usr/bin/env bash
# Plans and applies one stack for the `terraform` workflow's apply job, with the
# destroy guard: a plan that deletes, replaces or forgets anything stops unless
# CONFIRM=apply-destroys. Run from the repo root with the stack's role already assumed.
# Usage: tf-apply.sh <stack>   (shared, envs/dev, envs/stage, envs/main)
set -euo pipefail
stack=$1
mkdir -p "$TF_PLUGIN_CACHE_DIR"

echo "::group::$stack"
terraform -chdir="infra/$stack" init -lockfile=readonly
set +e
terraform -chdir="infra/$stack" plan -detailed-exitcode -out=tfplan
rc=$?
# One retry: Vercel's framework-list endpoint times out now and then.
if [ $rc -eq 1 ]; then sleep 15; terraform -chdir="infra/$stack" plan -detailed-exitcode -out=tfplan; rc=$?; fi
set -e
echo "::endgroup::"

if [ $rc -eq 0 ]; then echo "### \`$stack\` — No changes" >> "$GITHUB_STEP_SUMMARY"; exit 0; fi
[ $rc -eq 2 ] || { echo "::error::plan failed for $stack"; exit 1; }

# The plan JSON holds sensitive values in plain text: count from it, never print it.
terraform -chdir="infra/$stack" show -json tfplan > /tmp/plan.json
deletes=$(node .github/scripts/tf-summary.mjs deletes /tmp/plan.json 2>/tmp/deletes.txt)
rm /tmp/plan.json
{ echo "### \`$stack\`"; echo '```'; terraform -chdir="infra/$stack" show -no-color tfplan; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
if [ "$deletes" -gt 0 ] && [ "${CONFIRM:-}" != apply-destroys ]; then
  { echo "**Stopped: this plan deletes or replaces $deletes resources:**"; sed 's/^/- `/; s/$/`/' /tmp/deletes.txt; } >> "$GITHUB_STEP_SUMMARY"
  echo "::error::$stack deletes or replaces $deletes resources. Apply with workflow_dispatch stack=$stack confirm=apply-destroys on ${GITHUB_REF_NAME}."
  exit 1
fi
terraform -chdir="infra/$stack" apply tfplan
