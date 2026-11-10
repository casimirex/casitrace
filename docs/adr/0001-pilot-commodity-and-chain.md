# ADR 0001: Pilot commodity and chain (D1)

- **Status:** Accepted (product owner, 2026-11-10)
- **Roadmap ref:** roadmap-v2.md §2

## Context

The KDE/CTE set, product model and capture screens depend on the commodity.

## Decision

**Olive oil.** Pilot chain:

```text
Grove (producer) ──olives──▶ Mill (extraction) ──bulk oil──▶ Bottler / blender ──bottles──▶ Distributor or retailer
```

Shape: 3–5 olive growers → 1 mill (may also bottle) → 1 distributor or retailer. Design partners are still to be recruited (`docs/business/phase-0-open-items.md`).

Why olive oil: real transformation with a measurable yield (olives → oil, typically 12–22 % by mass), blending of lots (merge), short chain, high origin and fraud value, and no EUDR dependency.

## Consequences

- Product categories: olives, bulk olive oil, packaged olive oil, olive pomace, other.
- Units: olives in kg; bulk oil in kg (trade unit) with a litre ↔ kg conversion per product (density ≈ 0.91–0.92 kg/L); packaged oil counted in units with a net volume.
- Locations: groves with plot polygons, mills, storage tanks/warehouses, bottling plants, stores.
- KDEs per step: `docs/business/kde-cte-matrix.md`.
- Quality grade (extra virgin, virgin, lampante…) is a product attribute declared by the business; lab evidence for it arrives in P4, verification in P10–P12.
