# ADR 0006: Units and quantities (D6)

- **Status:** Accepted
- **Date:** 2026-11-10
- **Roadmap ref:** roadmap-v2.md §2

## Context

Split, merge and transform need mass-balance checks.

## Decision

Each product has a canonical unit of measure. Conversions live in a table. Quantities are `Decimal(18,6)`; never floating point.

## Consequences

Mass balance can be enforced in P5. API quantities are transmitted as decimal strings.
