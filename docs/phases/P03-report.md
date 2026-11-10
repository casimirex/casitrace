# Phase report — P3 Master data

- **Date:** 2026-11-10
- **Status:** Complete, pending review. One exit gate depends on a design partner (real product list).

## Phase 0 items closed in this phase

- ADR 0001 accepted: **olive oil** (grove → mill → bottler → distributor/retailer).
- ADR 0002 accepted: **EU**, member state chosen with design partners.
- KDE/CTE matrix drafted for olive oil (`docs/business/kde-cte-matrix.md`), awaiting partner review.
- Regulatory fact sheet: EU olive-oil marketing standard row added (unverified).

## Exit gates

| Gate | Status | Evidence |
|---|---|---|
| A partner's real product list imports from CSV | **Partly met** | A realistic olive-mill product list (8 products: olives, bulk EVO, 3 bottle sizes, pomace) imports, re-imports as a no-op, and an edited row becomes version 2 (`master-data.test.ts`, `masterdata.e2e.ts`). No real partner file exists yet; rerun with one when a design partner signs. |
| Editing a product leaves earlier versions intact | Pass | v1 stays readable after v2; `product_version` UPDATE is rejected by trigger and privilege; identical edits create no version. Lots arrive in P5 and will reference `product_version.id`. |
| Polygon validation rejects invalid geometry | Pass | Self-intersection, unclosed ring, zero area, crossing holes, vertex limit (`domain.test.ts`); API returns the reason; UI shows it on the field. |
| Isolation suite green | Pass | 34 operations, all attacked; RLS on every new tenant table, including a cross-tenant insert refused by the database. |

| NECESSARY item | Status |
|---|---|
| CSV import for products, locations, partners with validation preview | Done: per-cell errors, create/update/unchanged per row, all-or-nothing commit, templates, comma or semicolon files |

## Built

**Database** (migration `master_data`)
- `organization_profile`, `location` (GeoJSON boundary + computed area), `trading_partner` (external or linked org), `uom` (seeded, read-only), `product`, `product_version` / `product_component` / `product_unit_conversion` (append-only).
- RLS (`org_id = casitrace_current_org()` or platform access) on all seven tenant tables.

**API** (21 new operations)
- Profile, verification request, platform review queue and decision (super admin; reject needs a note). Changing legal identity after verification resets it.
- Locations: CRUD + archive, parent hierarchy with cycle check, GLN check digit, boundary validation and area.
- Partners: CRUD + archive; link to an on-platform organisation by ID (self-link and duplicates refused).
- Products: create (v1), revise (v N+1 or no-op), history, single version, archive/restore; GTIN check digit and per-org uniqueness; category attribute schemas for olives, bulk oil, packaged oil, pomace; unit rules per category; derived bottle volume conversion.
- Imports: template, preview, commit for products, locations, partners.
- New permissions: `location:*`, `partner:*`, `product:*`, `import:run`; operators can create/update/import but not archive.

**Web**
- Organisation tabs: Overview, Profile (with verification), Locations, Partners, Products (list, create, detail with version history and "save as new version"), Import (file check table, then import).
- Staff page: verification requests.

## Test results (local)

| Suite | Result |
|---|---|
| Lint / typecheck / build | Pass |
| Backend | 90 pass, 0 fail |
| E2E | 5 pass, stable over 3 consecutive runs |

## Deviations and decisions

- **Edited an applied migration.** `identity_access` revoked access on `_prisma_migrations`, which breaks Prisma's shadow database. The revoke moved to `scripts/db-setup.ts` and the stored checksum was updated in the dev and test databases. Nothing had been deployed. Anyone with an older local database must run `bun run db:setup` (or reset).
- `AUTH_RATE_LIMIT=off` added for the Playwright-started API only; refused in production by config validation.
- Bug found and fixed: the web client dropped field-level error details from API errors, so forms could show only the generic message.
- Some route handlers read validated input through a typed cast helper (`valid<T>()`) because the route-builder wrapper loses Hono's inferred types. Input is still Zod-validated before the handler runs. Worth replacing with fully inferred routes later.

## Known limitations

1. No map: boundaries are entered as GeoJSON text. A map picker would help growers (candidate for P5 field capture).
2. Partners link to on-platform organisations only by pasting an organisation ID; discovery comes with the public directory (P7) and claiming (P6).
3. Product composition (components) is supported by the API but not editable in the web form yet.
4. Location/partner edits are in place (not versioned). Events in P5 will snapshot what they need.
5. Import commits up to 5,000 rows in one transaction (2-minute limit); larger files need splitting.
6. Platform staff are still assigned by database update.

## Next: P4 — Evidence and certificates

Ready to start: private uploads with hashing and AV scan, evidence links to organisations/locations/products/versions, certificates with validity, review states and expiry alerts.
