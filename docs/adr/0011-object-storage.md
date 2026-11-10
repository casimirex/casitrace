# ADR 0011: Private S3-compatible object storage (D11)

- **Status:** Accepted
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

Evidence files must never be public by default.

## Decision

S3-compatible storage (SeaweedFS locally; MinIO images are no longer published) with private buckets only. Clients read and write through short-lived presigned URLs. The API uses Bun's built-in S3 client behind a storage port.

## Consequences

No AWS SDK dependency. Swapping provider means changing configuration only.
