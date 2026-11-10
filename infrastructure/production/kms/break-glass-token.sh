#!/bin/sh
# Break-glass: creates a short-lived root token from a quorum of unseal keys, uses it to issue a new
# orphan key-operator token, then revokes the root token (docs/operations/runbooks/key-rotation.md).
#   docker compose exec -it openbao sh /openbao/kms/break-glass-token.sh
# Unseal keys are read from stdin, one per line (custodians type them in turn).
set -eu
export BAO_ADDR=http://127.0.0.1:8200
otp=$(bao operator generate-root -generate-otp)
nonce=$(bao operator generate-root -init -otp="$otp" -format=json | tr -d ' \n' | sed -n 's/.*"nonce":"\([^"]*\)".*/\1/p')
encoded=""
while [ -z "$encoded" ] && read -r key; do
  out=$(bao operator generate-root -nonce="$nonce" -format=json "$key" | tr -d ' \n')
  encoded=$(echo "$out" | sed -n 's/.*"encoded_token":"\([^"]*\)".*/\1/p')
done
[ -n "$encoded" ] || { echo "not enough unseal keys" >&2; bao operator generate-root -cancel >/dev/null; exit 1; }
BAO_TOKEN=$(bao operator generate-root -decode="$encoded" -otp="$otp")
export BAO_TOKEN
echo "KEY_OPERATOR_TOKEN=$(bao token create -orphan -policy=key-operator -ttl=${TTL:-24h} -field=token)"
bao token revoke -self >/dev/null
echo "temporary root token revoked"
