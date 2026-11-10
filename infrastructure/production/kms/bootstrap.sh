#!/bin/sh
# One-time KMS set-up for a new environment (docs/operations/runbooks/key-rotation.md §Bootstrap).
# Prints the unseal keys and root token ONCE: store them offline with separate custodians, then
# revoke the root token (done at the end of this script).
#   docker compose exec openbao sh /openbao/kms/bootstrap.sh
# Env: SHARES (default 5), THRESHOLD (default 3).
set -eu
export BAO_ADDR=http://127.0.0.1:8200
SHARES=${SHARES:-5}
THRESHOLD=${THRESHOLD:-3}
# JSON flattened to one line so it can be parsed with sed (no jq in the image).
init=$(bao operator init -key-shares="$SHARES" -key-threshold="$THRESHOLD" -format=json | tr -d ' \n')
keys=$(echo "$init" | sed -n 's/.*"unseal_keys_b64":\[\([^]]*\)\].*/\1/p' | tr -d '"' | tr ',' ' ')
BAO_TOKEN=$(echo "$init" | sed -n 's/.*"root_token":"\([^"]*\)".*/\1/p')
[ -n "$keys" ] && [ -n "$BAO_TOKEN" ] || { echo "could not parse init output: $init" >&2; exit 1; }
echo "=== STORE OFFLINE NOW (one key per custodian); shown only once ==="
n=0
for key in $keys; do n=$((n + 1)); echo "UNSEAL_KEY_$n=$key"; done
i=0
for key in $keys; do
  [ "$i" -ge "$THRESHOLD" ] && break
  bao operator unseal "$key" >/dev/null
  i=$((i + 1))
done
export BAO_TOKEN
bao secrets enable transit
bao write -f transit/keys/passport-signing type=ed25519 exportable=false allow_plaintext_backup=false
# Same file the KMS integration test checks (apps/api/tests/kms-signer.test.ts).
bao policy write api-signer /openbao/kms/api-signer-policy.hcl
bao policy write key-operator - <<'HCL'
path "transit/keys/passport-signing/rotate" { capabilities = ["update"] }
path "transit/keys/passport-signing" { capabilities = ["read"] }
HCL
bao auth enable approle
bao write auth/approle/role/casitrace-api token_policies=api-signer token_ttl=1h token_max_ttl=4h secret_id_ttl=0
echo "KMS_ROLE_ID=$(bao read -field=role_id auth/approle/role/casitrace-api/role-id)"
echo "KMS_SECRET_ID=$(bao write -f -field=secret_id auth/approle/role/casitrace-api/secret-id)"
# Orphan: must survive revoking the root token below.
echo "KEY_OPERATOR_TOKEN=$(bao token create -orphan -policy=key-operator -ttl=720h -field=token)"
if [ "${KEEP_ROOT_TOKEN:-0}" != "1" ]; then bao token revoke -self; echo "root token revoked"; fi
