#!/usr/bin/env bash
# Stack routing for the `terraform` workflow, kept here so tf-stacks.test.mjs covers it.
#   tf-stacks.sh resolve  (EVENT, BRANCH, INPUT) -> stacks= line: the stacks the apply job runs, in order
#   tf-stacks.sh plan     (BASE)                 -> the stacks a PR into BASE plans
#   tf-stacks.sh drift                           -> the branch:stack pairs the drift job plans
#   tf-stacks.sh role <stack> <plan|apply>       -> the role ARN tf-as.sh assumes for that stack
# `prod/account` is applied from dev only (#345): its state is single, so applying it from
# several branches would revert each other's unpromoted changes.
# Later tasks add stacks by editing only the tables below.
set -euo pipefail
# stdout is $GITHUB_OUTPUT for `resolve`, so ::error:: lines go to stderr.

# The stacks a branch applies, in order.
branch_stacks() {
  case "$1" in
    dev)   echo "prod/account dev/account dev/app" ;;
    stage) echo "stage/account stage/app" ;;
    main)  echo "prod/app" ;;
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
    # On a promotion, stage's or main's older copy of prod/account would show dev's applied
    # changes as reverts, so prod/account is planned only on PRs into dev.
    case "$BASE" in
      dev)   echo "prod/account dev/account dev/app" ;;
      stage) echo "stage/account stage/app" ;;
      main)  echo "prod/app" ;;
      *) echo "::error::no stacks for PRs into $BASE" >&2; exit 1 ;;
    esac
    ;;
  drift)
    echo "dev:prod/account main:prod/app dev:dev/account dev:dev/app stage:stage/account stage:stage/app"
    ;;
  role) role "${2:?stack}" "${3:?mode}" ;;
  *) echo "usage: tf-stacks.sh resolve|plan|drift|role" >&2; exit 2 ;;
esac
