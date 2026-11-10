# ADR 0005: Public URL scheme (D5)

- **Status:** Accepted
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

QR codes must stay valid for the life of a pack and should work with retail scanners.

## Decision

Public product URLs follow GS1 Digital Link path syntax (`/01/{gtin}/10/{lot}`) on a Casitrace resolver host. Products without a GTIN use `/p/{productId}/l/{lotId}`. The resolver redirects to the current passport version.

## Consequences

URLs are stable even when passports change. Resolver host name is set in P7.
