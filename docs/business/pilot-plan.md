# Pilot plan (P9)

- **Status:** Ready to start once the go-live checklist below is done. **Not started:** the 6-week pilot needs real organisations and cannot be simulated.
- **Chain:** grove → mill → bottler → distributor/retailer (ADR 0001), one EU country (ADR 0002, country open).
- **Who:** 3–5 design-partner organisations covering at least one complete chain (a grower, a mill that also bottles or a bottler, one retailer). LOIs: `docs/business/phase-0-open-items.md`.

## Go-live checklist (before the first organisation)

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | Pilot country and hosting provider chosen (ADR 0002, ADR 0015 approved) | Product owner | open |
| 2 | Production VM installed per `runbooks/deploy.md`; KMS bootstrapped with real custodians | Operator | open |
| 3 | External uptime monitor configured; on-call address receives a test alert | Operator | open |
| 4 | Restore drill on the production VM recorded in `docs/operations/restore-drills/` | Operator | open (staging drill passed 2026-11-10) |
| 5 | Terms, privacy policy, DPA, retention periods reviewed by counsel; DPA signed by each organisation | Product owner | open |
| 6 | Threat model and ASVS checklist reviewed by a second person | Security reviewer | open |
| 7 | Second public-page language set to the pilot country's language (currently Italian placeholder) | Product owner | open |
| 8 | KDE matrix and regulatory facts verified (`docs/business/kde-cte-matrix.md`, `docs/compliance/regulatory-facts.md`) | Domain expert | open |
| 9 | CI running on GitHub (repository remote) | Operator | open |

## Schedule (6 weeks)

| Week | Goal | Activities |
|---|---|---|
| 0 | Onboarding | Each organisation: account, profile, verification documents, locations (plots with geometry), products, partners linked to each other. Measure KPI 1 per organisation. |
| 1–2 | Daily capture | Harvest, deliveries, milling, bottling, shipments recorded as they happen, on phones in the field/mill. KPI 2 measured automatically from the capture forms. Weekly 30-min call. |
| 2 | Evidence | Certificates (organic, PDO/PGI), lab analyses uploaded and verified; supplier requirements set by the mill/bottler. KPI 4. |
| 3 | Sharing and passports | Grants along the chain; first public pages with QR codes on real bottles (or labels for the pilot). KPI 3 and views. |
| 4 | Recall drill | Each mill/bottler runs a staffed mock recall from a real lot, timed by an observer (start → customer list exported). KPI 5. |
| 5 | Commercial | Pricing conversation; ask for signed quote or LOI with a price. KPI 7. |
| 6 | Report and decision | `apps/api/scripts/pilot-kpis.ts` report, interviews, KPI report written, go/no-go ADR. |

## Measuring the KPIs

| KPI | Target | Source |
|---|---|---|
| Time to onboard an org (invite → first lot) | < 1 day | KPI script: organisation created → first recorded event. Also note the calendar time from invitation email to account (manual log). |
| Time to record a lot event on a phone | < 2 min | KPI script: capture forms report first input → submit on touch devices (audit entry `capture`). Cross-check with 5 observed captures per organisation. |
| % of pilot lots with complete upstream trace | ≥ 90 % | KPI script: backward trace without redacted parts, every origin a harvest. |
| % of required evidence present and VERIFIED | ≥ 80 % | KPI script: supplier requirements × suppliers met (verified, unexpired). |
| Mock recall time | < 15 min | KPI script (drill start → first export) **and** the observer's stopwatch for the whole staffed drill. |
| QR scans / passport views | tracked | KPI script (daily counts; lower bound behind a CDN). |
| Partners willing to pay | ≥ 2 | Signed documents, counted manually. |

Command: `cd apps/api && bun --env-file=../../.env scripts/pilot-kpis.ts --orgs <ids> --since <pilot start> --out ../../docs/business/pilot-kpi-report.md`

## Weekly operations during the pilot

- Monday: check alerts of the past week, backups (`ops_backup_run`), `bun audit` result from CI, disk space.
- Friday: KPI script snapshot; note blockers reported by organisations.
