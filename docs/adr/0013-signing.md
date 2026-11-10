# ADR 0013: Platform signing key (D13)

- **Status:** Accepted — local key implemented in P7; KMS (OpenBao Transit) in P9, see ADR 0015
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

Published passports must be verifiable by third parties.

## Decision

Ed25519 platform key. Development uses a local key file; production uses a KMS. Signatures carry a key ID so rotated keys still verify old snapshots.

## Consequences

Nothing to build before P7. P9: production requires the KMS signer (`PASSPORT_SIGNER=kms`); key IDs are derived from the public key, so KMS key versions and old local keys share one published key list.
