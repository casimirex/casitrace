# ADR 0002: Pilot jurisdiction (D2)

- **Status:** Accepted (product owner, 2026-11-10); country to be chosen
- **Roadmap ref:** roadmap-v2.md §2

## Context

The first regulatory adapter (P11), data residency and the public-page languages depend on the market.

## Decision

**European Union, one member state.** The specific country is chosen when design partners are signed (likely an olive-producing state such as Italy, Spain, Greece or Portugal).

- First regulatory adapter (P11): EU General Food Law, Reg. (EC) 178/2002 Art. 18 (one step back, one step forward), plus the EU olive-oil marketing standard for grade and origin labelling (to be verified, see `docs/compliance/regulatory-facts.md`).
- Hosting: EU region. Personal data under GDPR.
- Public pages (P7): English plus the pilot country's language.

## Consequences

- Addresses and origin use ISO 3166-1 alpha-2 country codes; EU-wide defaults (metric units, decimal comma display handled by the UI locale).
- The country choice blocks only the P7 second language and the P9 hosting region, not P3–P6.
