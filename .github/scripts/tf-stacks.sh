#!/usr/bin/env bash
# Stack routing for the `terraform` workflow, kept here so tf-stacks.test.mjs covers it.
#   tf-stacks.sh resolve  (EVENT, BRANCH, INPUT) -> shared=, env=, role= lines for the apply job
#   tf-stacks.sh plan     (BASE)                 -> the stacks a PR into BASE plans
# `shared` is applied from dev only (#345): its state is single, so applying it from
# several branches would revert each other's unpromoted changes.
set -euo pipefail
# stdout is $GITHUB_OUTPUT for `resolve`, so ::error:: lines go to stderr.

case "${1:-}" in
  resolve)
    shared=""
    case "$BRANCH" in
      dev)   shared=shared; env=envs/dev; role=apply-nonprod ;;
      stage) env=envs/stage; role=apply-nonprod ;;
      main)  env=envs/main;  role=apply-prod ;;
      *) echo "::error::Terraform applies only from dev, stage or main" >&2; exit 1 ;;
    esac
    if [ "$EVENT" = workflow_dispatch ]; then
      # -n: on stage and main $shared is empty, and an empty INPUT must not match it.
      if [ -n "$shared" ] && [ "$INPUT" = "$shared" ]; then env=""
      elif [ "$INPUT" = "$env" ]; then shared=""
      else echo "::error::$INPUT is not applied from $BRANCH (this branch owns: $shared $env)" >&2; exit 1
      fi
    fi
    printf 'shared=%s\nenv=%s\nrole=%s\n' "$shared" "$env" "$role"
    ;;
  plan)
    # On a promotion, stage's or main's older copy of shared would show dev's applied
    # changes as reverts, so shared is planned only on PRs into dev.
    if [ "$BASE" = dev ]; then echo "shared envs/dev"; else echo "envs/$BASE"; fi
    ;;
  *) echo "usage: tf-stacks.sh resolve|plan" >&2; exit 2 ;;
esac
