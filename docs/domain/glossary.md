# Domain glossary

| Term                  | Meaning                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organisation**      | A business using Casitrace. It is the tenant: every private record belongs to exactly one organisation (ADR 0003).                                            |
| **External party**    | A supplier or customer that is not on Casitrace. Recorded by an organisation so its lots can still be traced.                                                 |
| **Location**          | A farm plot, facility or warehouse where events happen. May carry a GLN and a point or polygon.                                                               |
| **Product**           | A thing that is made or traded. Edits create a new **product version**; lots point at the version they were made with.                                        |
| **Lot**               | A quantity of one product version, identified by a lot code that is unique per (organisation, product). "Batch" means the same thing.                         |
| **Event**             | An append-only record that something happened to lots: ORIGINATE, RECEIVE, TRANSFORM, SHIP, ADJUST or VOID (ADR 0007).                                        |
| **CTE**               | Critical tracking event: a step in the chain where data must be captured (FSMA 204 term). In Casitrace, an event type.                                        |
| **KDE**               | Key data element: a field captured at a CTE (for example harvest date, field ID). Stored on the event and validated by a schema per event type and commodity. |
| **Genealogy**         | The parent → child graph between lots, written when TRANSFORM, RECEIVE and SHIP events are recorded.                                                          |
| **Custody**           | Which organisation or party holds a lot at a given time. Changes on SHIP/RECEIVE.                                                                             |
| **Handoff**           | The link between one organisation's SHIP and another organisation's RECEIVE.                                                                                  |
| **Sharing grant**     | Explicit permission for another organisation to see a scoped set of data. Without one, cross-org traces show a redacted node.                                 |
| **Evidence**          | A file (and its hash) that supports a claim, linked to an organisation, product, lot or event.                                                                |
| **Evidence state**    | SUBMITTED → CHECKED → VERIFIED, or REJECTED / EXPIRED / REVOKED. A hash proves the file is unchanged, not that it is true.                                    |
| **Certificate**       | Evidence with structured fields: scheme, issuer, scope, number, validity dates.                                                                               |
| **Claim**             | A statement about a product, lot or organisation (for example "organic").                                                                                     |
| **Attestation**       | A claim signed by an authorised issuer (post-MVP, P10).                                                                                                       |
| **Passport**          | A published, versioned and signed public snapshot of selected product or lot data.                                                                            |
| **Disclosure policy** | Field-by-field rules saying what a passport may show publicly.                                                                                                |
| **Recall case**       | An investigation started from one or more lots, with its computed impact set.                                                                                 |
| **Mass balance**      | The rule that a transformation's outputs cannot exceed its inputs (after unit conversion and tolerance).                                                      |
| **Outbox event**      | A row written in the same transaction as a state change, relayed later to background jobs (ADR 0010).                                                         |
| **Audit record**      | An append-only record of who did what, when, in which organisation.                                                                                           |
