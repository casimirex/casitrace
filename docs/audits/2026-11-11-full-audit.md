# Full audit — 2026-11-11 (after P9, commit 9fbeb75)

Scope: every quality gate re-run from scratch, the codebase checked against the non-negotiable rules in `CLAUDE.md`, the database checked against its security model, repository hygiene, the roadmap's MVP exit gates, and the claims in the published ebook. Performed by the implementer; the roadmap's "independent audit" still needs a second person.

## 1. Gates re-run

| Gate | Result |
|---|---|
| Lint (Biome, 213 files) | Pass |
| Typecheck (all 9 workspaces) | Pass, 0 errors |
| Build | Pass |
| Backend + worker tests | **182 pass, 0 fail** (22 files; trace p95 336 ms on 2,634–2,940 lots) |
| Browser tests (Playwright, axe) | **12 / 12 pass** (run on API port 3100: port 3000 is used by another local project) |
| OpenAPI client up to date | Pass (regeneration produced no diff); 107 operations, every one declares `x-access` |
| Dependency audit | 0 known vulnerabilities (379 packages) |
| Migrations vs database | In sync (`prisma migrate status`) |
| Alert rules (promtool) | Pass (10 rules, 7 test groups) — from the P9 run; unchanged since |

## 2. Rules checked in code and database

| Rule | Result |
|---|---|
| Tenant tables have row-level security with policies | Pass. Two tables carry `org_id` without RLS by design: `notification` (per user, filtered by `user_id`) and `outbox_event` (internal job queue, written in the command transaction, read only by the worker). |
| Append-only tables: trigger + no UPDATE/DELETE/TRUNCATE for the app role | Pass (11 tables with the reject trigger; app role has none of those privileges on them) |
| Runtime role is not superuser, cannot bypass RLS, owns only the pg-boss schema | Pass |
| Domain code free of Prisma, Hono, S3 | Pass |
| No `any`, no unexplained non-null assertions, no `console.log` | Pass |
| Storage keys never in responses; download links ≤ 15 min | Pass (5 min) |
| No tracked secrets; dependencies pinned exactly | Pass (only `.env.example` files; the committed dev signing key is refused in production) |
| Every state change through `runCommand` with an audit entry | **Two deviations**, see F-3 and F-4 |

## 3. Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| F-1 | Medium (usability, pilot) | A partner's shipment creates **no notification** for the receiving business; it only appears on the Shipments tab. In the pilot a mill may not notice deliveries waiting to be booked in, which delays traces. | **Fixed**: the SHIP transaction emits `handoff.created`; the worker notifies the receiver's members who may accept (in-app + email, deduplicated). Test in `exchange.test.ts` |
| F-2 | Low (public UI) | On public pages the bullets/numbers of the Origin and Journey lists hung outside their box (the box padding overrode the list indent). | **Fixed** (`ul.card, ol.card` indent); publication and hardening tests pass |
| F-3 | Low (consistency) | `decideVerification` (platform staff approve/reject a business) writes its audit row itself in a raw transaction instead of `runCommand`, so it cannot emit an outbox event (the business is not notified of the decision). | **Fixed**: runs through `runCommand` scoped to the organisation; owners/admins notified. Test in `master-data.test.ts` |
| F-4 | Low (rule wording) | Marking notifications read (`markRead`, `markAllRead`) changes state without an audit entry. It is per-user UI state, not a business record. | **Fixed** (documented): `CLAUDE.md` rule 1 lists the non-business exceptions |
| F-5 | Low (usability) | The Overview "Recent activity" shows internal action codes (`trace.event_recorded`) and actor IDs instead of names; lot events show key data elements as raw JSON. Hard to read for non-technical users. | **Fixed**: plain-language action labels, actor names (members by name; staff and system described, never named), labelled event details. Test in `master-data.test.ts` |
| F-6 | Low (feature gap) | No "change password" on the account page (only "Forgot password"). | **Fixed**: Password card on the account page (signs out other devices); audited as `user.password_changed`. Test in `identity.test.ts` |
| F-7 | Info | P9 report said 11 alert rules; there are 10. | **Fixed** in `docs/phases/P09-report.md` |

## 4. Ebook fact check

Every number and behaviour in the ebook was checked against the code, tests and reports. Corrected in version 2 of the published page:

- Reviewer role: also uploads documents and puts lots on hold.
- "Twelve areas": nine built contexts plus shared platform services; two (trust, compliance) are post-MVP (roadmap §4.1).
- Verification script is about 50 lines, not 40.
- Ten alarms, not eleven.
- Notifications: listed the real kinds (expiry, document requests/answers, recall notices and acknowledgements); deliveries appear on the Shipments tab only (F-1).
- Account page: no password change (F-6).

Confirmed as written: the five roles and recall permissions, lockout 5 attempts / 15 minutes, 7-day sessions with 15-minute fresh sign-in, file types (PDF, PNG, JPEG, WebP, text), 25 MB limit, 5-minute download links, expiry warnings at 30/7/0 days, 2 % mass-balance tolerance, directory search by name, city or region, GS1 Digital Link QR, English and Italian pages, every measured figure (0.71 s trace, 119 pages/s at 194 ms p95, 319 ms recall banner, 36 s restore, 148 s alert, Lighthouse 100/100/100, 182 and 12 tests, 0 of 107 operations leaking).

## 5. MVP exit gates (roadmap P9)

Unchanged from the P9 report: the engineering gates pass; the pilot (6 weeks), KPI report, go/no-go decision, production restore drill and a month of availability data need real organisations and a production server. ASVS and threat-model review by a second person, legal review, and a first CI run on GitHub are still open.

## 6. After the fixes (same day)

Backend + worker tests **183 pass, 0 fail**; browser tests **12 / 12**; lint, typecheck, OpenAPI client up to date. Screens re-captured and checked (activity log, account, lot events, public page lists); the ebook was updated to version 4 with the new screenshots and text.
