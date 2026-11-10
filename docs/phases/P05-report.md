# Phase report — P5 Traceability core (single organisation)

- **Date:** 2026-11-10
- **Status:** Complete, pending review. Four of five exit gates pass; one needs design partners.

## Exit gates

| Gate | Status | Evidence |
|---|---|---|
| Property-based tests: random split/merge/transform keep genealogy acyclic and mass-balanced | Pass | `traceability-properties.test.ts`: 3 seeds × 150 random operations (harvest, split, merge, transform with 0–110 % yield, ship, adjust, void). Checked every 25 steps: balances equal recomputation from events and are ≥ 0; no genealogy cycle; every transform output has a parent; no live transformation exceeds inputs × 1.02; over-yield attempts were refused. |
| Void + replacement gives the correct current view while keeping the original | Pass | `traceability.test.ts`: mistyped harvest (1,200 kg) voided and replaced (1,020 kg) in one call, same lot code; original event shows "voided by" with reason; voided lot kept; lot list shows only the corrected quantity. Voiding a shipment restores stock; voiding an upstream event with dependants is refused. |
| A direct SQL UPDATE on an event table fails | Pass | Trigger + revoked privileges on `trace_event`, `trace_event_line`, `lot_edge` (UPDATE, DELETE, TRUNCATE). |
| Trace NFR (10 hops / 5,000 lots, p95 < 2 s) | Pass | `traceability-performance.test.ts`: 10 levels × 500 lots, 4 parents each. p95 backward **~150 ms** (2,634 lots reached), forward **~180 ms** (2,940 lots). |
| Each pilot partner records 1 real lot on a phone | **Not done** | Needs design partners. Mobile capture forms and offline queue are ready (browser test with the network off). |

## Built

**Database** (migrations `traceability`, `lot_code_unique_unless_voided`)
- `lot` (projection: quantity, status active/consumed/shipped/on_hold/recalled/voided), `trace_event` (business and system time, KDEs + schema label, idempotency key + request hash, mass balance, override reason, VOID reference), `trace_event_line`, `lot_edge`. RLS on all four; append-only on events, lines, edges; value checks.

**API** (10 new operations, 57 total)
- `POST /events` (ORIGINATE, RECEIVE, TRANSFORM milling/blending/bottling/split/other, SHIP, ADJUST) with idempotency (`200` on replay, `409` if the key is reused for different content).
- `POST /events/{id}/void` with optional replacement; `GET /events`, `/events/{id}`.
- `GET /lots`, `/lots/{id}` (timeline), hold/release.
- `GET /lots/{id}/trace?direction=backward|forward|both&depth=` (nodes, edges, supplier deliveries with supplier lot codes, shipments to customers).
- `GET /lots/{id}/trace-report` — CSV, one row per lot per event, all KDEs, spreadsheet-formula-safe.
- Evidence can now be linked to lots and events.
- Permissions: `event:record|void|override`, `lot:hold`. Operators record and void; only owners/admins override mass balance; reviewers can hold lots.

**Rules enforced**
- Mass balance across units (kg, l via density, bottles via net volume × density); bottling 436 × 750 ml = 299.532 kg from 300 kg is accepted; outputs above inputs + 2 % are refused.
- No overdraw; concurrent consumption of the same stock records one event (row locks).
- KDE schemas from the olive-oil matrix (e.g. milling needs extraction method and malaxation temperature; bottling needs best-before; SSCC check digit).
- Harvests happen on a plot or farm; receipts need a supplier, shipments a customer; no future-dated events; held lots cannot be used.

**Web**
- Lots tab: list with search and status filter.
- Lot page: quantity, hold/release, **trace graph** (suppliers → lots → customers), trace table, customers list, CSV download, event timeline with KDEs, void with reason, linked evidence.
- Record tab (mobile-first): Harvest, Receive, Transform (multi-input/output), Ship. **Offline queue**: when the network is down, events are stored on the device with an idempotency key and sent automatically when it returns.

## Test results (local)

| Suite | Result |
|---|---|
| Lint / typecheck / build | Pass |
| Backend + worker | 128 pass, 0 fail |
| E2E | 9 pass, twice in a row |

## Deviations from the roadmap

1. **Production orders not built.** P5 listed a "lightweight production order" (planned inputs/outputs). Recording TRANSFORM events covers traceability; planning adds no trace data. Proposed: move to P12 (operations depth) unless a partner needs it for the pilot.
2. **Offline support is a submission queue, not a full offline app.** Events entered while offline are kept and sent later; the app itself still needs a connection to load. A service worker for the app shell can follow when partners test in the field.
3. ADJUST, hold/release and the `voided` lot status were added; they were implied by the model but not listed.

## Known limitations

1. Traces stop at the organisation boundary; cross-organisation handoff and redacted nodes are P6.
2. The trace graph draws up to 150 lots; larger chains show the table only.
3. Events cannot be edited (by design); corrections go through VOID, and dependants must be voided newest-first.
4. Lot codes are generated as `SKU-YYMMDD-XXXX` when not given; organisations may want their own pattern (configurable later).
5. Mass balance tolerance is a fixed 2 % for all processes.

## Next: P6 — Cross-organisation exchange

Handoff of shipments to on-platform receivers, claiming of external parties, sharing grants, cross-org traces with redacted nodes, evidence requests, supplier approval.
