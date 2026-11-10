# Data retention policy

- **Status:** Draft for legal review (P9). Periods marked *verify* depend on the pilot country (ADR 0002) and must be confirmed by counsel before go-live (`docs/compliance/regulatory-facts.md`).
- **Principle:** keep traceability records as long as food law and customers' own obligations need them; keep personal data only as long as needed for the account and security; delete automatically where the system can.

## Business records (customer data, Casitrace is processor)

| Data | Kept for | Why | How it ends |
|---|---|---|---|
| Lot events, lots, genealogy, KDEs (`trace_event`, `lot`, `lot_edge`) | Life of the customer's account + **5 years** after the end of the calendar year of the event (*verify*: longer for products with a long shelf life, e.g. shelf life + 6 months if that is more) | Reg. (EC) 178/2002 Art. 18 traceability; recall investigations; customers' audits | Append-only: deleted only by the off-boarding procedure below, never edited |
| Evidence files and their status history | Same as the records they support; certificates at least until 5 years after expiry (*verify*) | Proof of conformity | Off-boarding procedure |
| Recall cases and notices | 5 years after closing (*verify*) | Regulator and insurer questions | Off-boarding procedure |
| Published passports (all versions) | As long as product carrying the QR code may be in circulation: best-before + 2 years, minimum 5 years after publication (*verify*) | Consumers scan old bottles; signatures must stay verifiable | Withdraw (page says so) — versions are kept |
| Audit log | 5 years (*verify*) | Accountability, security investigations | Off-boarding / scheduled purge when the period is confirmed |
| Sharing grants and shared-access log | Same as the records shared | Proof of what was shared with whom | Off-boarding procedure |

## Personal data (Casitrace is controller for accounts)

| Data | Kept for | How it ends |
|---|---|---|
| User accounts (name, email, password hash, 2FA secret) | While the account exists | User deletes the account (GDPR erasure, P2): personal data removed; audit entries keep the user ID only |
| Sessions | Until 30 days after expiry | **Automatic**, daily (`apps/worker/src/retention.ts`) |
| Email verification and reset tokens | Until 1 day after expiry | **Automatic**, daily |
| In-app notifications | Read: 180 days; unread: 365 days | **Automatic**, daily |
| Sign-in rate-limit and lockout counters | Rate limits: 1 day; lockout rows per P2 rules | **Automatic**, daily |
| Public rate-limit counters (`rate_limit_bucket`) | 1 hour after the window ends; keys are hashes, no IP addresses | **Automatic**, daily |
| Passport view counts | Indefinitely (aggregate counts per day, no personal data) | — |
| Server logs (request ID, path, status, duration; no bodies) | 30 days | Log rotation on the VM / log store retention |
| Traces and metrics | Traces 14 days, metrics 30 days | Backend retention settings |
| Backups | 14 daily base backups + WAL in between | WAL-G `delete retain FULL 14` (daily); a deleted account disappears from backups within 14 days |

## Off-boarding an organisation

1. The organisation exports its data (GDPR/contract: CSV trace reports, evidence downloads; export endpoint P2 for users).
2. Records stay readable to the organisation (read-only) until the end of the retention period, unless it instructs earlier deletion in writing and confirms it keeps its own copy for its legal obligations.
3. At the end of the period, an operator runs the deletion procedure (to be built before the first off-boarding: a platform command that removes the organisation's rows and objects, audited; append-only triggers are bypassed only by this owner-role procedure).
4. Other organisations keep their own records of what they received (cross-organisation links point to a removed organisation, shown as "organisation no longer on Casitrace").
