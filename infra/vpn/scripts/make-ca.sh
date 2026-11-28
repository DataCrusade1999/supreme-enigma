#!/usr/bin/env bash
# Make the offline CA for the VPN VM's Roles Anywhere certificates.
# Usage: make-ca.sh <outdir>
set -euo pipefail
umask 077
# Git Bash on Windows rewrites a /CN=... argument into a file path, and with
# MSYS_NO_PATHCONV=1 it would also leave /tmp-style paths unconverted for openssl.
# So the script works in the output directory with relative file names.
export MSYS_NO_PATHCONV=1

if [ $# -ne 1 ]; then
  echo "usage: $0 <outdir>" >&2
  exit 2
fi
outdir="$1"

if [ -e "$outdir/ca.key" ]; then
  echo "refusing to overwrite $outdir/ca.key" >&2
  exit 1
fi

mkdir -p "$outdir"
(
  cd "$outdir"
  openssl ecparam -name prime256v1 -genkey -noout > ca.key
  openssl req -x509 -new -key ca.key -sha256 -days 3650 \
    -subj "/CN=bgm-looper vpn CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out ca.pem
)

cat <<MSG
Wrote $outdir/ca.key and $outdir/ca.pem.
Store $outdir/ca.key in your password manager now, then delete it from disk.
ca.pem is the public certificate; copy it to infra/prod/account/vpn-ca.pem.
MSG
