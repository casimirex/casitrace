# OpenBao/Vault policy for the Casitrace API (ADR 0015). Least privilege: sign with the passport key
# and read its public keys. No export, rotate, config, delete or other keys. Rotation is an operator
# action (docs/operations/runbooks/key-rotation.md) with a separate, audited token.
path "transit/sign/passport-signing" {
  capabilities = ["update"]
}

path "transit/keys/passport-signing" {
  capabilities = ["read"]
}
