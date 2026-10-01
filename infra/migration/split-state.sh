#!/usr/bin/env bash
# One-off: splits the pre-split infra/main state into the four stacks, using
# state-map.tsv. Works on local files only; never touches the S3 backend.
# Run from an empty directory outside the repo, so Terraform uses the local backend.
set -euo pipefail

old=$1
out=$2
map="$(dirname "$0")/state-map.tsv"
dry=${DRY_RUN:+-dry-run}

mkdir -p "$out"
while IFS=$'\t' read -r from stack to; do
  [ -z "$from" ] && continue
  file="$out/${stack//\//-}.tfstate"
  terraform state mv $dry -lock=false -state="$old" -state-out="$file" "$from" "$to"
done < "$map"
