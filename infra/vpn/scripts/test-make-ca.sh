#!/usr/bin/env bash
# Test for make-ca.sh. Uses a temp directory only; no key is written under the repo.
set -uo pipefail

script="$(dirname "$0")/make-ca.sh"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

out="$dir/ca"

# Sourced in a subshell so stat runs in the process that created the key: on Git Bash for
# Windows the file mode is only visible to the creating process (other processes see 644).
mode="$(source "$script" "$out" >/dev/null 2>&1 && stat -c %a "$out/ca.key")" || fail "first run exits 0"
[ -f "$out/ca.key" ] || fail "ca.key created"
[ -f "$out/ca.pem" ] || fail "ca.pem created"

text="$(openssl x509 -in "$out/ca.pem" -noout -text)"
grep -q "CA:TRUE" <<<"$text" || fail "ca.pem has CA:TRUE"
grep -q "Certificate Sign" <<<"$text" || fail "ca.pem key usage has Certificate Sign"
grep -q "ASN1 OID: prime256v1" <<<"$text" || fail "ca.pem uses prime256v1"

end="$(openssl x509 -in "$out/ca.pem" -noout -enddate | cut -d= -f2)"
days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
{ [ "$days" -ge 3640 ] && [ "$days" -le 3660 ]; } || fail "enddate is about 3650 days away (got $days)"

[ "$mode" = "600" ] || fail "ca.key mode is 600"

before="$(sha256sum "$out/ca.key" | cut -d' ' -f1)"
bash "$script" "$out" >/dev/null 2>&1 && fail "second run exits 1"
[ "$(sha256sum "$out/ca.key" | cut -d' ' -f1)" = "$before" ] || fail "ca.key unchanged after second run"

echo ok
