# Phase report — P8 Recall and incident handling

- **Date:** 2026-11-10
- **Status:** Complete, pending review. Both exit gates pass in automated tests; the 15-minute gate still needs a timed drill with real people on pilot data.

## Exit gates

| Gate | Status | Evidence |
|---|---|---|
| Mock recall on pilot data completes (impact identified and exported) in < 15 min; record the time | Pass (system) | `apps/web/e2e/recall.e2e.ts` on pilot-like data (3 grove harvests + a grower delivery → milling → two bottle sizes → 4 customers): drill started from the lot page, impact and contact list exported, clock **0.2 s**. This is software time with a script clicking; the pilot KPI is the time a quality team needs end to end, to be measured in a staffed drill during P9. |
| Passport banner appears within 1 minute of starting the recall | Pass | Same test: real recall started in the UI; the lot's public page (JavaScript off) shows "Product recall" **319 ms** later. Also in `recalls.test.ts`. |

## Built

**Database** (migrations `recalls`, `lot_recall_flag`)
- `recall_case` (real or drill, reason, severity, customer instructions, impact snapshot, start / impact / export / close times), `recall_lot`, `recall_notice` (two-party: visible to the recalling organisation and to a notified customer on Casitrace), `lot.recall_case_id`.

**API** (8 new operations, 107 total)
- Start a recall or drill from one or more lots: forward trace across organisations (redacted where not shared), this organisation's affected lots, customers that received them, locations.
- Real recall: flags lots (blocked as event inputs; public banner), notifies customers on Casitrace (in-app + email) and the own team. Drill: no flags, no external notices, team notification labelled "drill".
- Export: CSV of affected lots and the customer contact list (email, city, shipped lots and quantities); first export stops the clock.
- Acknowledgements: customers on Casitrace acknowledge in their own account; for others the recalling organisation records how they confirmed. Close (lots stay flagged).
- Incoming notices for customers, including the lots in their own records that came from the recalled shipments.
- Permissions: real recalls owner/admin (`recall:start`); drills also reviewers (`recall:drill`); acknowledging notices operators and up.

**Web**
- Recalls tab: incoming recalls from suppliers (with your affected lots and acknowledge), your recalls and drills with their export times.
- Lot page: start a mock recall or (owners/admins) a real recall, with a clear warning; a banner when the lot is under recall.
- Recall page: running clock, affected lots (redacted organisations named), customers with channel and acknowledgement, CSV export, close.

## Problems found and fixed

1. **Worker database pool too small** (real production issue). With 4 concurrent jobs and a 5-connection pool (the outbox relay holds one), email jobs waited up to 30 s for a connection under load. Pool now `WORKER_CONCURRENCY + 4`; the domain-event consumer runs 4 jobs in parallel (configurable). Measured after the fix: email jobs 0.05 s average, longest queue wait 1.9 s; the full browser suite runs in 30 s instead of 50–80 s.
2. **Stale evidence lists** after an upload (product/lot pages kept showing the old cached list for a few seconds). Uploading now refreshes them.
3. Two fields labelled "Reason" on the lot page; the recall field is now "Recall reason".

## Test results (local)

| Suite | Result |
|---|---|
| Lint / typecheck / build | Pass |
| Backend + worker | 160 pass, 0 fail |
| E2E | 12 pass, three runs in a row |

## Known limitations

1. Customers further downstream are notified by their own supplier (each organisation recalls its own lots); there is no automatic cascade. A notice shows the receiving organisation which of its lots are affected so it can start its own recall.
2. Recall impact only reaches into other organisations' downstream where they share it (`downstreamDepth` on a grant); otherwise they appear as redacted and are notified as direct customers.
3. No regulator notification (e.g. RASFF) integration.
4. Notices to customers off Casitrace are a contact list; calls/emails are made outside the system and recorded as acknowledgements.

## Next: P9 — Production hardening and pilot launch

Threat model, backups and a restore drill, observability, load tests against the NFRs, KMS for the signing key, Lighthouse, shared rate-limit store, legal documents, runbooks, and the 6-week pilot with KPIs (including a staffed mock-recall drill).
