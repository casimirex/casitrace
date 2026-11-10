# ADR 0013: Platform signing key (D13)

- **Status:** Accepted — implemented in P7/P9
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

Published passports must be verifiable by third parties.

## Decision

Ed25519 platform key. Development uses a local key file; production uses a KMS. Signatures carry a key ID so rotated keys still verify old snapshots.

## Consequences

Nothing to build before P7.
