# CASITRACE — Roadmap v2

**Status:** Proposed replacement for `roadmap.md` (v1)
**Date:** 2026-11-10
**Stack (unchanged from v1):** Bun · TypeScript · Hono · Prisma · PostgreSQL · React + Vite · OpenAPI · Docker

> v1 describes a good product vision but it is not executable as written. Phases depend on things that are built later, several catalogued modules never get a phase, the hardest problem (traceability _across_ organisations) is missing, and the pilot comes last instead of first.
>
> v2 keeps the v1 vision and stack. It reorders the work into **vertical slices** so that every phase ends with something a real user can run, and it gives every phase measurable entry and exit gates.
>
> Appendix A lists every v1 defect and how v2 fixes it.

---

## 0. How to read this document

Each capability is tagged:

| Tag            | Meaning                                                                             | Test                                                           |
| -------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **REQUIRED**   | Without it the product does not work or cannot legally or safely operate.           | "If we remove this, does the pilot fail?" → yes                |
| **NECESSARY**  | Needed for the pilot to show value or for production to be trusted.                 | "Will design partners or auditors reject us without it?" → yes |
| **SUFFICIENT** | The line where we stop. Anything past it is deferred until pilot data justifies it. | Listed explicitly as _Deferred_                                |

A phase is **done** only when every exit gate passes in CI or in a recorded demo. "Code exists" is not done.

---

## 1. Product scope

### 1.1 The one job for the MVP

> **Given any lot of a food product, a business can find, within minutes, every input lot and supplier upstream and every customer downstream, across company boundaries. It can show the evidence behind each claim and publish a verifiable public page for the product.**

Every MVP feature must serve this sentence. Anything that does not is deferred.

### 1.2 The questions the platform must answer (from v1 §1), and where each is answered

| #   | Question                           | Answered by                                                   | Phase   |
| --- | ---------------------------------- | ------------------------------------------------------------- | ------- |
| 1   | Who produced it?                   | Organisation + originating event (harvest/production)         | P3, P5  |
| 2   | Where was it produced?             | Location (point/polygon) on the originating event             | P3, P5  |
| 3   | What inputs were used?             | Transformation event input lots                               | P5      |
| 4   | How was it processed?              | Transformation event type + KDEs                              | P5      |
| 5   | Which batches were involved?       | Lot genealogy graph                                           | P5      |
| 6   | Who handled it?                    | Custody on ship/receive events                                | P5, P6  |
| 7   | Where did it move?                 | Ship/receive events with locations                            | P5, P6  |
| 8   | Which certifications/claims apply? | Certificates + claims linked to org/product/lot               | P4      |
| 9   | What evidence supports them?       | Evidence links + review status                                | P4      |
| 10  | Can it be independently verified?  | Signed passport snapshot (P7); third-party attestations (P10) | P7, P10 |

### 1.3 Explicit non-goals (v2 will not build these before product–market fit)

- Blockchain or any distributed ledger.
- Microservices. The system stays one modular monolith and one worker process.
- A general ERP: no full inventory valuation, accounting or MRP.
- Consumer-facing AI chat.
- 19 hard-coded roles. Roles are permission sets with templates instead (§4.3).
- Every regulatory framework. Only the one that matches the pilot's market is in scope (§6, P11).
- Sustainability or carbon claims. These come only after the compliance engine and attestations exist.

---

## 2. Decisions that must be made before code (Phase 0 outputs)

These choices change the data model. v1 leaves all of them open.

| #   | Decision                      | Recommended default                                                                                                                                                   | Why it matters                                                                   |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| D1  | **Pilot commodity and chain** | One commodity, 3–5 producers → 1 processor → 1 distributor/retailer                                                                                                   | The KDE/CTE set (which data is captured at which step) depends on the commodity. |
| D2  | **Pilot jurisdiction**        | One country/market                                                                                                                                                    | Decides which regulatory adapter is built first and where data must reside.      |
| D3  | **Tenancy model**             | Organisation = tenant (no separate `Tenant` entity)                                                                                                                   | v1 has both `Tenant` and `Organization` without defining how they differ.        |
| D4  | **Identifier scheme**         | Internal UUIDv7. Optional GS1 keys (GTIN, GLN, SSCC). Lot code is unique per (org, product).                                                                          | Needed for QR codes, interoperability and genealogy.                             |
| D5  | **Public URL scheme**         | GS1 Digital Link–compatible paths served by a Casitrace resolver: `https://id.casitrace.…/01/{gtin}/10/{lot}`. Products without a GTIN get a Casitrace fallback path. | The QR code then works with retail scanners and stays stable over time.          |
| D6  | **Units and quantities**      | Each product has a canonical UoM. Explicit conversion table. `Decimal(18,6)`.                                                                                         | Splitting, merging and mass balance cannot be checked without it.                |
| D7  | **Event immutability**        | Events are append-only. Mistakes are fixed with **correction/void events** that reference the original. A DB trigger blocks `UPDATE`/`DELETE`.                        | Without a correction model, "append-only" breaks on the first data-entry error.  |
| D8  | **Tenant isolation**          | Application-level scoping (Prisma client extension) **plus** Postgres RLS using `SET LOCAL app.org_id` inside each transaction                                        | Two independent layers of protection.                                            |
| D9  | **Auth**                      | Use a maintained library (for example Better Auth with its Prisma adapter and organisation plugin). Do not hand-roll auth.                                            | Avoids writing security-critical code from scratch.                              |
| D10 | **Jobs and outbox**           | Postgres-backed queue (for example pg-boss) plus a transactional outbox table. **Redis is not required for the MVP.**                                                 | One less piece of infrastructure to run.                                         |
| D11 | **Object storage**            | S3-compatible (MinIO locally). Private buckets only. Access through short-lived signed URLs.                                                                          | Evidence must never be public by default.                                        |
| D12 | **Test stack**                | One unit runner (Vitest _or_ `bun test`, not both). Testcontainers Postgres for integration tests. Playwright for E2E.                                                | v1 names a unit runner only.                                                     |
| D13 | **Signing**                   | Ed25519 platform key held in a KMS (local file key in dev). JWS/Data-Integrity-compatible format.                                                                     | Needed in P7 for signed public snapshots.                                        |

Every decision is recorded as an ADR in `docs/adr/`.

---

## 3. Non-functional requirements (quantified)

v1 has non-functional _categories_ but no numbers. Without numbers there is nothing to test against.

| Area                | Requirement (MVP)                                                                                      | Verified by                    |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Trace query latency | Backward or forward trace over 10 hops / 5,000 lots: p95 < 2 s                                         | Load test in CI on seeded data |
| Trace report        | Export a sortable CSV of every KDE for a lot within 24 h of request (target: < 1 min)                  | E2E test                       |
| Public page         | Passport page TTFB p95 < 500 ms (cached), page works without JS for core data                          | Load test, Lighthouse          |
| Availability        | 99.5 % monthly for the pilot                                                                           | Uptime monitor                 |
| Durability          | RPO ≤ 24 h, RTO ≤ 4 h; restore drill performed and recorded                                            | Restore drill log              |
| Tenant isolation    | 0 cross-tenant reads/writes in the automated isolation suite (every endpoint)                          | CI gate                        |
| Audit               | 100 % of state-changing commands produce an audit record with actor, org, time, before/after reference | Integration test               |
| Security            | OWASP ASVS L2 for auth/session; no critical/high dependency CVEs open > 7 days                         | CI scan, review                |
| Privacy             | GDPR: personal data inventory, export and erasure for user accounts; DPA template for customers        | Checklist + test               |
| Accessibility       | WCAG 2.2 AA on public pages and core capture forms                                                     | axe in Playwright              |
| Field capture       | Capture forms usable on a mid-range phone over 3G. Queued offline submit for harvest/receive.          | Manual device test             |
| i18n                | 2 languages on public pages at pilot (pilot language + English)                                        | E2E                            |

---

## 4. Architecture (right-sized)

### 4.1 Bounded contexts: 12, not 40

v1's 40 modules overlap. For example, Parties, Suppliers and Directory are the same thing, and so are Lots, Traceability and Production. v2 uses 12 contexts. Each one has domain, application, infrastructure and presentation layers, following v1 §6.

| #   | Context                     | Owns                                                                                                         | v1 modules merged        |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 1   | **identity**                | users, sessions, credentials, MFA                                                                            | 01                       |
| 2   | **access**                  | organisations (tenants), memberships, roles, permissions, invitations, API keys                              | 02, 03 (membership), 39  |
| 3   | **parties**                 | org profiles, locations/facilities, trading relationships, external (off-platform) parties, public directory | 03, 04, 05, 06, 09       |
| 4   | **catalog**                 | products, versions, ingredients/composition, UoM, classifications                                            | 07, 08                   |
| 5   | **evidence**                | documents, versions, evidence links, certificates, review status, expiry                                     | 19, 20, 21               |
| 6   | **traceability**            | lots, events (CTEs + KDEs), genealogy, custody, shipments, corrections, trace queries                        | 10–18 (operational core) |
| 7   | **exchange**                | cross-org shipment handoff, data-sharing grants, evidence requests                                           | new (missing in v1)      |
| 8   | **publication**             | passports, versions, disclosure policy, QR/resolver, signed snapshots                                        | 28, 29                   |
| 9   | **recalls**                 | recall cases, impact sets, notifications, drills                                                             | 27                       |
| 10  | **trust** _(post-MVP)_      | attestations, issuers, trust registry, revocation                                                            | 22, 23                   |
| 11  | **compliance** _(post-MVP)_ | frameworks, versioned rules, assessments, findings                                                           | 24                       |
| 12  | **platform**                | audit log, outbox, notifications, jobs, admin, billing, AI gateway                                           | 31–38, 40                |

Agriculture depth, quality/testing, inventory and sustainability (v1 modules 11, 25, 26, 16, 30) are **event types and KDE schemas inside `traceability`** during the MVP. They become separate contexts only if pilot data shows they need to be.

### 4.2 Core traceability model (the part v1 left undefined)

```text
Lot ──< LotEvent >── Event
                     │  type: ORIGINATE | RECEIVE | TRANSFORM | SHIP | ADJUST | VOID
                     │  kdes: JSON validated by versioned KDE schema per (type, commodity)
                     │  occurredAt (business time) / recordedAt (system time)
                     │  locationId, orgId, actorId
                     │  correctsEventId? (correction chain)
                     ▼
               EventInput (lotId, qty, uom)   EventOutput (lotId, qty, uom)
                     │
                     ▼
               LotEdge (parentLotId → childLotId, eventId)   ← materialised genealogy
```

- **Split** is a TRANSFORM with 1 input and N outputs. **Merge** is a TRANSFORM with N inputs and 1 output. No special-case tables are needed.
- **Mass balance:** Σoutputs ≤ Σinputs × conversion factor × (1 + tolerance). If the check fails, the event is rejected or held for approval with a recorded reason. Yield and waste are stored as outputs.
- **Two time axes.** `occurredAt` is when it happened (business time). `recordedAt` is when it was entered (system time). Late entries and corrections stay honest because both are kept.
- **Trace queries** run as a recursive CTE over `LotEdge` (Prisma TypedSQL/`$queryRaw`) with a depth limit and indexed `(parentLotId)`/`(childLotId)`.
- **Cross-org links:** org A's SHIP event and org B's RECEIVE event are joined by a `Handoff` record (P6). Neither org can change the other's events.

### 4.3 Authorization

- Each permission is a pair `(resource, action)`, for example `lot:create` or `evidence:approve`.
- Role templates at MVP: **Owner, Admin, Operator (capture), Quality/Reviewer, Viewer**, plus platform **SuperAdmin** and **Support (read-only, audited)**. Custom roles are post-MVP.
- Checks run in the application service layer, not only in routes. RLS (D8) sits underneath as the backstop.
- Cross-org reads are allowed only through explicit `SharingGrant` records (P6).

### 4.4 Evidence truth states (from v1 §2 Layer 4, made concrete)

`SUBMITTED → CHECKED (integrity + format ok) → VERIFIED (human reviewer or authorised issuer) → [EXPIRED | REVOKED | REJECTED]`

Public pages always show the state and never upgrade it. A hash proves that a file has not changed since it was hashed. It does not prove that the file is truthful. The UI copy has to say this plainly.

---

## 5. MVP phases (P0–P9)

Phases run in order. Each phase lists its **Depends on** and its **Exit gates**. Size is relative: S ≈ 1–2 weeks, M ≈ 2–4, L ≈ 4–6, for a team of 2–3 engineers. These are estimates, not commitments.

### P0 — Discovery and decisions · S

**Goal:** Remove the unknowns that would otherwise force a data-model rewrite.

REQUIRED
- Pick the pilot commodity, chain and jurisdiction (D1, D2). Get written intent (LOI or email) from at least 3 design partners covering at least 2 chain steps.
- Run one recorded walkthrough of each partner's current process, including paper forms and spreadsheets.
- Write the **KDE/CTE matrix** for the pilot commodity: for each step, which data is captured, by whom, on which device, and how often.
- Record ADRs D1–D13 and the NFR table (§3).
- Write the domain glossary: lot, batch, event, custody, evidence, claim, attestation, passport.
- Write a regulatory fact sheet for the pilot market, with each fact checked against the official source (see §7).

**Exit gates:** LOIs on file · KDE matrix reviewed by at least 1 partner · ADRs merged · glossary merged.

### P1 — Engineering foundation · M

**Depends on:** P0

REQUIRED
- Bun workspace: `apps/api` (Hono), `apps/web` (React + Vite), `apps/worker`, `packages/{contracts,shared,api-client,test-utils}`.
- Prisma + Postgres; migrations via `prisma migrate` only (never `db push` outside local dev).
- Contract-first API: Zod schemas → OpenAPI (for example `@hono/zod-openapi`) → generated typed client for the web app.
- Standard error envelope, request ID, structured logging (Pino), config validated by Zod at boot.
- **Transactional outbox** plus worker that dispatches outbox rows to jobs (D10).
- **Audit log** writer used by every command handler (append-only table, `UPDATE`/`DELETE` blocked by a trigger).
- Object storage adapter (MinIO locally) with signed URLs (D11).
- Docker Compose (postgres, minio, mailpit). CI runs lint (Biome), typecheck, unit, integration (Testcontainers) and E2E smoke (Playwright).
- `CLAUDE.md` containing the rules from v1 §11 plus the rules in this document.

**Exit gates:** fresh clone → `bun install && docker compose up && bun run dev` works · `/health` and `/ready` (DB + storage) return OK · CI green on main · an outbox event round-trips to the worker in an integration test · an audit row is written by a sample command.

### P2 — Identity and access · M

**Depends on:** P1

REQUIRED
- Register, verify email, login, logout, password reset and session management through the auth library (D9). Login rate-limiting and lockout.
- Create an organisation; membership; invitations by email; org switcher; the role templates from §4.3.
- Tenant scoping via Prisma extension **and** RLS (D8).
- **Isolation test harness:** for every registered route, automatically assert that org B cannot read or write org A's resources. Adding a route without coverage fails CI.

NECESSARY
- TOTP MFA, mandatory for platform admins.
- Account data export and deletion (GDPR).

**Exit gates:** isolation suite covers 100 % of routes, 0 failures · auth flows pass E2E · session cookies are `HttpOnly; Secure; SameSite=Lax` with CSRF protection on cookie-authenticated mutations · security checklist (ASVS L2 auth subset) signed off.

### P3 — Master data: organisations, locations, products · M

**Depends on:** P2

REQUIRED
- Organisation profile: legal name, registration number, address, business roles (producer, processor and so on), verification status (`UNVERIFIED | PENDING | VERIFIED`) set by the platform admin through a simple review queue.
- Locations and facilities: type (farm/plot, facility, warehouse), address, optional GLN, geo point or GeoJSON polygon validated on input (PostGIS is optional; GeoJSON in `jsonb` is enough for the MVP).
- **Trading partners:** link to an on-platform org **or** create an **external party** (a supplier or customer not on Casitrace). Most real suppliers will be off-platform at first, so this is needed from day one.
- Products: name, category, optional GTIN, canonical UoM, ingredients/composition (product → ingredient products), allergens, origin, storage and shelf-life fields. **Versioning:** edits create a new `ProductVersion`, and lots reference the version they were made with.
- UoM table and conversions (D6).

NECESSARY
- CSV import for products, locations and trading partners, with a validation preview. Pilot onboarding depends on this.

**Exit gates:** a partner's real product list imports from CSV · editing a product leaves earlier lots pointing at the old version · polygon validation rejects invalid geometry · isolation suite green.

### P4 — Evidence and certificates · M

**Depends on:** P3. This phase comes _before_ traceability because P3, P5 and P6 all attach evidence. v1 put evidence at Phase 09, after the phases that need it.

REQUIRED
- Upload to private storage: MIME sniffing plus an allow-list, size limit, AV scan (ClamAV in the worker), SHA-256 hash stored, immutable versions.
- `EvidenceLink` to an org, location, product, product version, lot or event. One file can back many records.
- Certificate = evidence with structured fields: scheme, issuer (free text plus an optional link to a known issuer), scope, certificate number, valid from/to.
- Review state machine (§4.4) with reviewer, reason and timestamp at every transition.
- An expiry job notifies owners 30, 7 and 0 days before expiry and sets status `EXPIRED`. This needs only minimal notifications: in-app plus email.
- Sharing is off by default. Evidence becomes visible to another org only through a grant (P6).

Deferred: OCR, AI classification, e-signature.

**Exit gates:** re-hashing a downloaded file matches the stored hash · an expired certificate changes status and triggers a notification in an integration test · there is no public URL to any evidence object (tested) · AV scan blocks the EICAR test file.

### P5 — Traceability core (single organisation) · L

**Depends on:** P3, P4. _This is the core of the product, so it gets the most time and the most tests._

REQUIRED
- Lots: lot code unique per (org, product); quantity and UoM; product version; status (`ACTIVE | CONSUMED | SHIPPED | ON_HOLD | RECALLED`).
- Events from §4.2, with KDE payloads validated against the P0 KDE matrix schemas:
  - **ORIGINATE:** harvest, catch or first production, at a location (plot).
  - **RECEIVE:** from an external party or (in P6) from an on-platform org.
  - **TRANSFORM:** production, processing, packing, split or merge, with input and output lots and quantities.
  - **SHIP:** to a trading partner, with a shipment reference and an optional SSCC.
  - **ADJUST:** stock correction with a reason.
  - **VOID:** correction of an earlier event, with the reason and replacement events.
- Mass-balance validation with tolerance; a failing event can only be saved through override with permission `event:override` and an audit record.
- Append-only enforcement in the DB (D7). Lot genealogy edges are written in the same transaction as the event.
- **Backward and forward trace** API and UI: a graph view plus a table view. Depth-limited and paginated.
- **Trace report export** (CSV/XLSX) containing every KDE for a lot's upstream and downstream.
- Lightweight production order: planned inputs and output product. A full MES (manufacturing execution system) is out of scope.
- Mobile-first capture screens for ORIGINATE, RECEIVE and SHIP. Submissions are queued offline (service worker) with idempotency keys.

**Exit gates:**
- Property-based tests: random sequences of split/merge/transform keep the genealogy acyclic and mass-balanced.
- A void plus replacement event gives the correct current view while keeping the original.
- A direct SQL `UPDATE` on an event table fails.
- Trace NFR met on seeded data (§3).
- Each pilot partner records 1 real lot end to end on a phone in a recorded session.

### P6 — Cross-organisation exchange · M

**Depends on:** P5. _This phase is missing from v1. Without it, "end-to-end traceability" stops at the edge of each company._

REQUIRED
- **Handoff:** when org A ships to org B, org B gets an inbound shipment. Org B accepts it, which creates a RECEIVE event and links B's lot to A's lot. Org B can also dispute it (quantity or product mismatch).
- **Claiming:** an external party later joins Casitrace and claims its records (verified by email-domain or invite token). Its history is then linked.
- **SharingGrant:** org A grants org B (or "any downstream holder of lot X") access to a scoped set of data: lot KDEs, specific evidence, upstream depth. Every access is logged.
- **Cross-org trace:** a trace crosses into another org only where a grant exists. Elsewhere it returns a **redacted node** ("upstream lot exists at a verified supplier; details not shared"). It never leaks data and never silently truncates.
- **Evidence requests:** org B asks supplier A for a document type. A fulfils it by sharing evidence. Status is tracked.
- **Supplier approval:** a supplier is `APPROVED` only when its required evidence types are present and VERIFIED.

**Exit gates:** a 3-org E2E test (producer → processor → retailer) gives a full trace for the retailer where grants exist and redacted nodes where they do not · the isolation suite is extended to grants (revoking a grant removes access immediately) · a dispute flow is tested.

### P7 — Public layer: passport, QR, directory · M

**Depends on:** P5, P6 (and P4 for evidence states)

REQUIRED
- Passport: a product-level or lot-level **published snapshot**, built from a template plus a disclosure policy that marks each field public or private. Publishing creates an immutable `PassportVersion`.
- **Signed snapshot:** the platform signs the canonical JSON of each published version (D13). The public page and a public `GET /verify/{id}` let anyone check the signature and see the evidence states. This is the MVP form of "public verification". It proves that _Casitrace published this and it has not changed_. It does **not** prove that the claims are true.
- QR generation pointing to the D5 resolver URL. The resolver redirects to the right passport version and supports a recall banner.
- Public product page: server-rendered or pre-rendered, 2 languages, origin map, simplified journey, certificates with their states, and a clear legend explaining what "verified" means.
- Public organisation profile and directory search, showing only orgs that opted in. Rate-limited and protected against scraping.

**Exit gates:** printed QR → phone → correct page in under 2 s on 4G · no private field appears in any public response (automated test that diffs public payloads against the disclosure policy) · the signature is verified by an independent script that uses only the public key · Lighthouse/axe pass.

### P8 — Recall and incident handling · S–M

**Depends on:** P6, P7

REQUIRED
- Start a recall case from one or more lots. Impact set = forward trace across grants: affected lots, shipments, customers and locations.
- Notify affected direct customers (on-platform: in-app plus email; off-platform: an exportable contact list). Track acknowledgements.
- Put affected lots `ON_HOLD`/`RECALLED`. Show a banner on the passport page.
- **Mock recall drill** mode: same flow, no external notifications, timed.

**Exit gates:** a mock recall on pilot data completes, impact set identified and exported, in under 15 minutes (record the actual time; it is a pilot KPI) · the passport banner appears within 1 minute of starting the recall.

### P9 — Production hardening and pilot launch · M

**Depends on:** P1–P8

REQUIRED
- Threat model (STRIDE) for auth, the public endpoints, uploads and the signing key. Fix every high finding.
- Backups with PITR, plus a **performed and recorded restore drill**.
- Observability: OpenTelemetry traces, metrics, error tracking, uptime checks and alert routing.
- Load test against the §3 NFRs.
- Key management: the signing key moves to a KMS, with a documented rotation procedure. Old versions must still verify after rotation.
- Legal minimum: terms, privacy policy, DPA, a data-retention policy for evidence and events.
- Runbooks: deploy, rollback, restore, key rotation, incident response.
- Onboard the pilot partners and run for at least 6 weeks.

**Pilot KPIs (measured, not estimated):**

| KPI                                                        | Target to continue |
| ---------------------------------------------------------- | ------------------ |
| Time to onboard an org (invite → first lot)                | < 1 day            |
| Time to record a lot event on a phone                      | < 2 min            |
| % of pilot lots with complete upstream trace               | ≥ 90 %             |
| % of required evidence present and VERIFIED                | ≥ 80 %             |
| Mock recall time                                           | < 15 min           |
| QR scans / passport views                                  | tracked, no target |
| Partners willing to pay (signed quote or LOI with a price) | ≥ 2                |

**Exit gates (MVP complete):** all NFRs met or explicitly waived in an ADR · restore drill logged · pilot ran 6 weeks · KPI report written · go/no-go decision for post-MVP recorded.

---

## 6. Post-MVP phases (gated by pilot evidence)

Do not start a post-MVP phase unless the pilot KPI report or a paying customer asks for it. The order below is the default, and the KPI report can change it.

| Phase                                   | Scope                                                                                                                                                                                                                                                                  | Start trigger                                                                | Key exit gates                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **P10 Trust: attestations and issuers** | W3C VC Data Model 2.0 credentials, `did:web` issuer identities, an issuer trust registry (who may attest what), revocation via a status list, key rotation, third-party certifier onboarding                                                                           | A certifier or buyer wants to issue or consume signed claims                 | An external verifier validates a credential with no Casitrace account; revocation shows up within 5 min    |
| **P11 Compliance engine**               | Versioned, effective-dated rules (v1 §11 interface); assessments that can be reproduced; findings; corrective actions; **one** adapter for the pilot market (for example EU 178/2002 Art. 18 one-up/one-down, US FSMA 204 KDE/CTE records, or EUDR due-diligence data) | A customer has a dated regulatory obligation                                 | Re-running an assessment for a past date gives the same result; adding a rule needs no change to core code |
| **P12 Operations depth**                | Agriculture (fields, inputs, activities), quality checks and lab results, inventory positions, production recipes and yields                                                                                                                                           | Pilot partners asking for these to replace another tool                      | Each new feature emits standard P5 events (no parallel data model)                                         |
| **P13 Integration platform**            | Public API keys and OAuth client credentials, idempotency keys, webhooks with retries and signatures, **EPCIS 2.0** import/export, CSV mapping templates, API versioning policy                                                                                        | An ERP or WMS integration is requested                                       | Round-trip EPCIS conformance on sample documents; a webhook delivery is retried and stays idempotent       |
| **P14 Billing**                         | Plans, usage metering, quotas, Stripe (or similar), trials, invoices                                                                                                                                                                                                   | At least 2 partners willing to pay (P9 KPI)                                  | Upgrading and downgrading change limits without data loss                                                  |
| **P15 AI assistance**                   | Provider-independent gateway (v1 §13 architecture), document field extraction **with mandatory human confirmation**, missing-evidence detection, natural-language trace query over the authorised APIs only, prompt/version logging, per-tenant quotas                 | Enough real documents and events exist to evaluate against                   | Labelled evaluation set; AI never changes state without a human approving; outputs are schema-validated    |
| **P16 Analytics and reporting**         | Dashboards, compliance/expiry reports, read replicas or materialised views                                                                                                                                                                                             | Reporting queries affect transactional latency, or customers ask for reports | Reporting cannot slow down trace queries (separate pool or replica)                                        |
| **P17 Enterprise**                      | SSO (SAML/OIDC), custom roles, data residency, configurable approval workflows, audit export                                                                                                                                                                           | An enterprise deal requires it                                               | Per-feature                                                                                                |

---

## 7. Regulatory facts to verify in P0 (do not hard-code)

These are statements as understood on 2026-11-10. Each must be checked against the official source before anyone builds on it.

| Topic                             | What to check                                                                                                                                                                                                                                             | Impact on the roadmap                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **EU "Digital Product Passport"** | The ESPR (Reg. (EU) 2024/1781) DPP regime **excludes food and feed**.                                                                                                                                                                                     | Call the feature "product passport" in marketing. Do **not** claim ESPR compliance for food.                           |
| **EU General Food Law**           | Reg. (EC) 178/2002 Art. 18 requires one-step-back / one-step-forward traceability. Reg. (EU) 931/2011 adds requirements for food of animal origin.                                                                                                        | P5 + P6 already meet the one-up/one-down data need. This is the natural first adapter for an EU pilot.                 |
| **EUDR**                          | Reg. (EU) 2023/1115. Application dates have been postponed more than once, and there is a pending simplification review. Check current dates, the commodity list (cattle, cocoa, coffee, oil palm, rubber, soya, wood) and the geolocation/polygon rules. | Relevant only if the pilot commodity is in scope. P3 polygons and P5 ORIGINATE location already capture the core data. |
| **US FSMA 204**                   | Food Traceability Rule (21 CFR Part 1 Subpart S). The compliance date was extended (reported as July 2028). It requires KDE/CTE records and a sortable spreadsheet within 24 h. Check whether the pilot foods are on the Food Traceability List.          | The P5 event model maps onto CTEs. The P5 trace report covers the 24 h spreadsheet.                                    |
| **GS1**                           | GS1 Digital Link URI syntax, EPCIS 2.0 / CBV 2.0                                                                                                                                                                                                          | D5 and P13                                                                                                             |
| **GDPR**                          | Sole-trader farms and farm geolocation can be personal data.                                                                                                                                                                                              | P2 export/erasure, P9 DPA and retention, P7 disclosure defaults                                                        |

---

## 8. Definition of Done (every phase)

1. The phase's exit gates pass. They are automated where stated, and recorded (video or log) where manual.
2. Migrations are committed and reversible, or have a forward-fix plan written down.
3. The OpenAPI spec is regenerated and the generated client compiles.
4. Unit tests cover domain rules. Integration tests cover every command handler. The isolation suite is green. E2E tests cover the phase's main flow.
5. Lint, typecheck and tests are green in CI. There are no new critical/high CVEs.
6. Every new command writes an audit record. Every new route has an authorization check and an isolation test.
7. Docs are updated: affected ADRs, domain doc and the API changelog.
8. A completion report lists what was built, test results, known limitations and gate status.
9. Independent audit pass (v1 Prompt 3) before the next phase starts.

---

## 9. Dependency graph

```text
P0 ─► P1 ─► P2 ─► P3 ─► P4 ─► P5 ─► P6 ─► P7 ─► P8 ─► P9 ══► pilot KPI report
                         │            ▲     │                      │
                         └────────────┘     └──► (P8 uses P7)      ▼
                    (P5 attaches evidence)                 P10 … P17 (triggered)
```

Two phases can run in parallel if staffing allows:
- The P7 public page UI shell can start during P6 against mocked contracts.
- The P9 observability and backups work can start during P5.

---

## 10. Risk register

| Risk                                | Likelihood | Impact | Mitigation                                                                                                            |
| ----------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| Suppliers will not enter data       | High       | Fatal  | External parties (P3), CSV import, mobile offline capture (P5), shared evidence requests (P6); measure time per event |
| Genealogy becomes inconsistent      | Medium     | Fatal  | DB-enforced append-only, mass balance, property-based tests (P5)                                                      |
| Cross-tenant data leak              | Medium     | Fatal  | Two-layer isolation (D8), route-coverage gate (P2), public payload diff test (P7)                                     |
| Users read "verified" as "truthful" | High       | High   | Explicit truth states (§4.4), legend on public pages, no ESPR claims                                                  |
| Regulatory dates change             | High       | Medium | Effective-dated rules (P11); fact sheet re-checked each quarter                                                       |
| Scope creep toward a full ERP       | High       | High   | Non-goals (§1.3); post-MVP phases need a trigger                                                                      |
| Signing key compromise              | Low        | High   | KMS, rotation procedure, versioned key IDs in signatures (P9)                                                         |
| Pilot partners drop out             | Medium     | High   | ≥ 3 producers; LOIs before P1                                                                                         |

---

## 11. Milestones

| Milestone                   | Phases | Demonstrable outcome                               |
| --------------------------- | ------ | -------------------------------------------------- |
| M0 Foundation               | P0–P1  | Repo, CI, decisions, partner LOIs                  |
| M1 Accounts and master data | P2–P3  | Partners log in, import products and locations     |
| M2 Evidence                 | P4     | Certificates uploaded, reviewed, expiry alerts     |
| M3 Single-org trace         | P5     | One partner traces a real lot backward and forward |
| M4 Chain trace              | P6     | Producer → processor → retailer trace with grants  |
| M5 Public                   | P7–P8  | QR on a real pack; mock recall under 15 min        |
| M6 Pilot                    | P9     | 6-week pilot, KPI report, go/no-go                 |

---

## Appendix A — Verification of v1 `roadmap.md`

### A.1 Blocking defects (the plan cannot be executed as written)

| #   | v1 location            | Defect                                                                                                                                                                                                                 | v2 fix                                                                           |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Ph 03, 05, 06 vs Ph 09 | Certificate associations (03), supplier documents and declarations (05) and agricultural evidence (06) all need Documents/Evidence, which v1 builds only in Ph 09.                                                     | Evidence moves to **P4**, before traceability.                                   |
| 2   | Ph 05 acceptance       | "Received raw materials can be associated with batch records", but batches arrive only in Ph 07.                                                                                                                       | Lots and RECEIVE events are part of one phase (**P5**).                          |
| 3   | Ph 09                  | Needs "AI classification", but AI arrives in Ph 13. Also needs "expiration generates alerts", but notifications arrive in Ph 14.                                                                                       | AI deferred (P15). Minimal notifications built in P4.                            |
| 4   | Whole plan             | **Cross-organisation traceability is never designed.** Each org's data is isolated, yet forward/backward trace "across the supply chain" needs to cross tenants. v1 has no handoff, sharing grants or redaction model. | New **P6 Exchange** and `SharingGrant` with redacted nodes.                      |
| 5   | Ph 07 / 08             | Batch split, merge and transform have **no quantity, UoM or mass-balance rules**, so genealogy cannot be checked for consistency.                                                                                      | D6 + mass balance in P5.                                                         |
| 6   | DB rule 10, Ph 07      | "Append-only" and "cannot be silently rewritten" are stated, but there is **no correction model** and no DB-level enforcement.                                                                                         | D7: VOID/correction events plus a trigger.                                       |
| 7   | §14 MVP vs §8 sequence | The MVP needs evidence, QR and public verification (Ph 09, 10, 12), but the sequence builds agriculture and the full trace engine first. The MVP cannot be delivered by following the phase order.                     | Phases rebuilt as vertical slices; MVP = P0–P9.                                  |
| 8   | Ph 16 before Ph 18     | Billing comes before the pilot, while v1 itself says pricing must be validated through pilots. Customer discovery is at the very end.                                                                                  | Partners and LOIs in **P0**. Billing (P14) triggered by willingness-to-pay.      |
| 9   | §4 catalogue           | Modules **Inventory (16), Orders (18), Quality (25), Testing (26), Sustainability (30), Workflow (34)** never get a phase. **Recalls (27)** gets only "impact analysis", with no recall execution.                     | Mapped in §4.1. Recall execution in **P8**. The rest are deferred with triggers. |
| 10  | Arch. decision 8       | A transactional outbox is required, but no phase builds it, although events are needed from Ph 07.                                                                                                                     | Built in **P1**.                                                                 |

### A.2 Significant gaps (the product would be weak or unsafe)

| #   | Gap                                                                                                       | v2 fix                               |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 11  | Off-platform suppliers/customers are not modelled. Most real suppliers will not be on Casitrace at first. | External parties (P3), claiming (P6) |
| 12  | No QR/URL standard. GS1 Digital Link is not mentioned, so QR codes may not work with retail scanners.     | D5                                   |
| 13  | No issuer trust governance: who is allowed to attest, and how certifiers are onboarded.                   | P10 trust registry                   |
| 14  | NFRs are unquantified ("search works efficiently").                                                       | §3 table                             |
| 15  | No offline or mobile capture for farms and warehouses.                                                    | P5                                   |
| 16  | No bulk import until Ph 15, but pilot onboarding needs it.                                                | CSV in P3                            |
| 17  | No business-time vs system-time distinction for late or corrected entries.                                | §4.2                                 |
| 18  | `Tenant` vs `Organization` is ambiguous.                                                                  | D3                                   |
| 19  | Tenant isolation relies on application code only.                                                         | D8 RLS                               |
| 20  | "Digital Product Passport" for food suggests ESPR compliance, but ESPR excludes food.                     | §7                                   |
| 21  | No mock recall or recall-time KPI tied to the regulatory 24 h expectation.                                | P5 report, P8 drill                  |
| 22  | Auth is hand-built with no MFA.                                                                           | D9, P2 MFA                           |
| 23  | No E2E tool, no property-based tests for genealogy.                                                       | D12, P5                              |
| 24  | GDPR (farm owner as data subject, geolocation) mentioned only in passing.                                 | §3, P2, P9                           |

### A.3 Over-specification (removed or deferred to reach "sufficient")

| v1 item                                                               | Why it was cut                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 40 modules                                                            | They overlap. 12 contexts carry the same responsibilities with clear ownership.        |
| 19 named roles                                                        | Permission sets plus 5 templates cover the pilot. Custom roles go to P17.              |
| Redis from day 1                                                      | Postgres covers queues, outbox and rate limits at pilot scale.                         |
| 6 AI assistants                                                       | No data to ground them yet. Deferred to P15 with an evaluation gate.                   |
| Full regulatory catalogue (EUDR, organic, labelling, sustainability…) | Only the one adapter that matches the pilot market, in P11.                            |
| Billing tiers in detail                                               | Pricing is unknown until the pilot measures willingness to pay.                        |
| PostGIS required                                                      | GeoJSON validation is enough for the MVP. Add PostGIS when spatial queries are needed. |

### A.4 What v1 got right (kept)

- The product vision, the seven-layer framing and the separation of claims from verified facts.
- A modular monolith, clean architecture, dependency inversion, and Prisma confined to persistence.
- No blockchain at the start; hashes and signatures first.
- Configurable, effective-dated compliance rules.
- The phase-by-phase Claude Code workflow and the independent audit prompt (v1 §12–13). Use them unchanged with v2's phase numbers.
- The engineering, database, API, frontend and testing rules in v1 §11. Copy them into `CLAUDE.md`.
