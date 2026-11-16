#!/usr/bin/env bash
# Stack routing for the `terraform` workflow, kept here so tf-stacks.test.mjs covers it.
#   tf-stacks.sh resolve  (EVENT, BRANCH, INPUT) -> stacks= line: the stacks the apply job runs, in order
#   tf-stacks.sh plan     (BASE)                 -> the stacks a PR into BASE plans
#   tf-stacks.sh drift                           -> the branch:stack pairs the drift job plans
#   tf-stacks.sh role <stack> <plan|apply>       -> the role ARN tf-as.sh assumes for that stack
# `prod/account` is applied from main only (#524): its state is single, so it is applied from
# one branch, and main is the one that deploys to production. A PR into dev plans it as an
# early look at what main will apply.
# Later tasks add stacks by editing only the tables below.
set -euo pipefail
# stdout is $GITHUB_OUTPUT for `resolve`, so ::error:: lines go to stderr.

# The stacks a branch applies, in order.
branch_stacks() {
  case "$1" in
    dev)   echo "dev/account dev/app" ;;
    stage) echo "stage/account stage/app" ;;
    main)  echo "prod/account prod/app" ;;
    *) echo "::error::Terraform applies only from dev, stage or main" >&2; return 1 ;;
  esac
}

# The role for a stack: `dev/*` and `stage/*` live in their own accounts, `prod/*` in
# the prod account (223376380711).
role() {
  local stack=$1 mode=$2 prod=arn:aws:iam::223376380711:role/bgm-looper-tf
  case "$mode" in plan|apply) ;; *) echo "::error::mode must be plan or apply, got $mode" >&2; return 1 ;; esac
  case "$stack" in
    dev/account|dev/app)     echo "arn:aws:iam::624586968135:role/bgm-looper-tf-$mode" ;;
    stage/account|stage/app) echo "arn:aws:iam::792682047320:role/bgm-looper-tf-$mode" ;;
    prod/account|prod/app)
      if [ "$mode" = apply ]; then echo "$prod-apply-prod"; else echo "$prod-plan"; fi ;;
    *) echo "::error::no role for $stack" >&2; return 1 ;;
  esac
}

case "${1:-}" in
  resolve)
    stacks=$(branch_stacks "$BRANCH")
    if [ "$EVENT" = workflow_dispatch ]; then
      case " $stacks " in
        *" $INPUT "*) [ -n "$INPUT" ] && stacks=$INPUT ;;
        *) echo "::error::$INPUT is not applied from $BRANCH (this branch owns: $stacks)" >&2; exit 1 ;;
      esac
    fi
    printf 'stacks=%s\n' "$stacks"
    ;;
  plan)
    # prod/account is applied from main, so a PR into dev plans it as an early look at what
    # main will apply, and a PR into main plans it as the apply. A PR into stage does not: its
    # older copy of prod/account would show main's applied changes as reverts.
    case "$BASE" in
      dev)   echo "prod/account dev/account dev/app" ;;
      stage) echo "stage/account stage/app" ;;
      main)  echo "prod/account prod/app" ;;
      *) echo "::error::no stacks for PRs into $BASE" >&2; exit 1 ;;
    esac
    ;;
  drift)
    echo "main:prod/account main:prod/app dev:dev/account dev:dev/app stage:stage/account stage:stage/app"
    ;;
  role) role "${2:?stack}" "${3:?mode}" ;;
  *) echo "usage: tf-stacks.sh resolve|plan|drift|role" >&2; exit 2 ;;
esac
