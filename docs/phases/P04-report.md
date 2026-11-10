# Phase report — P4 Evidence and certificates

- **Date:** 2026-11-10
- **Status:** Complete, pending review. All four exit gates pass locally.

## Exit gates

| Gate | Status | Evidence |
|---|---|---|
| Re-hashing a downloaded file matches the stored hash | Pass | `evidence.test.ts`: download through the 5-minute link, SHA-256 equals the upload's; integrity endpoint reports a match, and reports a **mismatch** after the stored object is tampered with. Browser test shows "Unchanged since upload". |
| An expired certificate changes status and triggers a notification | Pass | `evidence.test.ts`: warnings at 20 days (30-day threshold), 6 days (7-day), "expires today", then `expired` the day after the end date; each sent once; in-app notifications for owner and reviewer plus queued emails. |
| No public URL to any evidence object | Pass | Anonymous GET on the stored object → 403; API responses never contain storage keys; downloads only via audited presigned links. |
| AV scan blocks the EICAR test file | Pass | Real ClamAV 1.4.3: EICAR upload → `rejected` with the signature in the history, object deleted, download refused (API and browser tests). |

## Built

**Database** (migration `evidence`)
- `evidence` (type, status, certificate fields, expiry notice marker), `evidence_file` (version, sha256, sniffed media type, scan result; immutable except scan columns), `evidence_link` (organisation, location, partner, product, product version; lot/event reserved for P5), `evidence_status_change` (append-only), `notification` (per user).
- RLS on the four evidence tables; value checks on statuses, link targets, hash format, validity order.

**API** (13 new operations, 47 total)
- Upload (multipart, 25 MB), new file version, update details (only before verification), review (verify / reject / revoke), link / unlink, list with filters (status, type, linked record, expiring within N days), detail with files/links/history, download link, integrity check.
- Notifications: list (unread first), mark read, mark all read.
- New permissions `evidence:create|update|verify`; reviewers can verify, operators cannot.

**Worker**
- clamd INSTREAM client; scan handler (re-hash, scan, status move, delete infected); daily expiry job (pg-boss schedule, UTC cron) with in-app notifications and emails; `evidence-expiry` email template.

**Web**
- Evidence tab: list with status filter and "expiring in 30 days", upload form with certificate fields and links. Detail page: plain-language meaning of the status, files with full SHA-256, download and integrity check, review actions with reason, replace file, history. Evidence card on product pages. Notifications page and unread count in the header.

## Test results (local)

| Suite | Result |
|---|---|
| Lint / typecheck / build | Pass |
| Backend + worker | 107 pass, 0 fail |
| E2E | 7 pass, twice in a row |

## Decisions

- **Four-eyes rule:** the uploader of the current file cannot verify it. In a one-person organisation evidence stays "checked", which states the truth.
- "Verified" means *reviewed by someone in this organisation*; the UI says so on every evidence page. Third-party attestations are P10.
- Storage write happens before the database transaction; a failed transaction leaves an unreferenced private object (harmless) rather than a record pointing at nothing.
- Infected files: the row is kept for the audit trail, the object is deleted.
- Notifications are user-owned rows (not tenant RLS), always filtered by `user_id`.

## Bug found and fixed

- Product lists were served from a stale cache after creating a product, so the evidence "Product" dropdown was empty. The create action now refreshes product lists.

## Known limitations

1. No OCR, AI classification or e-signatures (deferred by the roadmap).
2. Unreferenced objects from failed uploads are not cleaned up yet (add a sweep in P9).
3. Links to lots and events are reserved but refused until P5.
4. Sharing evidence with other organisations comes with P6 (off by default now).
5. The expiry job runs once a day at 05:00 UTC; status changes are not instant at midnight.
6. ClamAV needs ~1 GB of memory and 1–2 minutes to start the first time (signature download), also in CI.
7. CI has still not run on GitHub (no remote).

## Next: P5 — Traceability core

Lots, append-only events (ORIGINATE, RECEIVE, TRANSFORM, SHIP, ADJUST, VOID) with olive-oil KDE schemas, mass balance, genealogy, backward/forward trace, trace report export, mobile capture.
