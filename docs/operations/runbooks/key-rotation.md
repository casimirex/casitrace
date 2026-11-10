# Runbook: passport signing key (KMS)

ADR 0013 / 0015. The Ed25519 key lives in OpenBao Transit (`transit/keys/passport-signing`), created non-exportable. The API signs through AppRole `casitrace-api` (policy `api-signer`: sign + read public keys only). Every key version stays published at `/api/v1/public/keys`, so passports signed with older versions keep verifying.

## Bootstrap {#bootstrap}

Once per environment, with the custodians present:
1. `docker compose up -d openbao`
2. `docker compose exec openbao sh /openbao/kms/bootstrap.sh` (production: 5 key shares, threshold 3).
3. Each custodian copies **one** `UNSEAL_KEY_n` to their own offline store (password manager vault or sealed paper). Nobody holds 3.
4. Copy `KMS_ROLE_ID`, `KMS_SECRET_ID` into `.env` (secrets manager); give `KEY_OPERATOR_TOKEN` (orphan, 30 days, rotate-only) to the key operator.
5. The script revokes the root token at the end. Confirm: `bao token lookup` with it fails.

## Unseal after a restart

The KMS starts sealed after any restart of the VM or container; the API will not start (and publishing would fail) until it is unsealed. Public pages and verification keep working only once the API is up, so treat a sealed KMS as an outage.
`docker compose exec -it openbao bao operator unseal -address=http://127.0.0.1:8200` — three custodians each enter their key. Then `docker compose up -d --wait`.

## Routine rotation (yearly, or when a custodian or operator leaves)

1. `docker compose exec -e BAO_TOKEN=<key-operator token> openbao bao write -address=http://127.0.0.1:8200 -f transit/keys/passport-signing/rotate` → `latest_version` increases.
2. Nothing else: the running API learns the new version on its next signature (and re-reads key versions every 5 minutes). New passports use the new key ID; old ones still verify.
3. Check: `curl -s https://<site>/api/v1/public/keys` shows the new key as `current` and the old one as `previous`; publish a test passport and verify it and an old one with `scripts/verify-passport.mjs`.
4. Record the rotation (date, old/new key IDs) in the change log.

The key operator cannot export the key, delete it, make it exportable or deletable, or create other keys (tested in `apps/api/tests/kms-signer.test.ts`).

## Suspected compromise of the API host or AppRole credentials

1. Rotate the key (above) **and** issue new AppRole credentials: break-glass (below) → `bao write -f auth/approle/role/casitrace-api/secret-id` and destroy the old secret ID (`bao write auth/approle/role/casitrace-api/secret-id/destroy secret_id=…`).
2. From the OpenBao audit log (`/openbao/logs/audit.log` volume), list `transit/sign/passport-signing` requests in the suspect window and compare with `passport.published` audit entries in Casitrace. Signatures without a matching publication are forgeries: publish the list of affected key IDs and time window, and withdraw the old key version from `/api/v1/public/keys` by setting `min_available_version` only if every legitimate passport signed with it has been re-published.

## Break-glass: new operator token

When the key-operator token expired or was lost: custodians run `docker compose exec -it openbao sh /openbao/kms/break-glass-token.sh` and enter unseal keys one per line (threshold). The script creates a temporary root token, issues a new orphan `key-operator` token, and revokes the root token.

## Moving from the local key (development era) to the KMS

Passports signed before the KMS was introduced verify through `PASSPORT_PREVIOUS_KEYS` (JSON list of `{kid, x}`). Keep every key that ever signed a published passport in that list.

## Drill record

| Date | Environment | What | Result |
|---|---|---|---|
| 2026-11-10 | staging rehearsal | Bootstrap (1 share), AppRole signing, rotation v1 → v2 with the operator token while the API was running, break-glass operator token | API switched to `ed25519-a0e8c8778b477ea8` on the next publish without restart; passports signed with `ed25519-a16bb90fa553a5bb` still `valid: true` with `scripts/verify-passport.mjs`; operator token denied `config` (make deletable) and `export` (403) |
