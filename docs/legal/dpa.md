# Data processing agreement (GDPR Art. 28) — DRAFT for legal review

Between **[customer organisation]** (controller) and **[Casitrace legal entity]** (processor).

1. **Subject and duration.** Processing of the controller's traceability records, evidence files and user data in Casitrace for the term of the service agreement, plus the retention periods in Annex 2.
2. **Nature and purpose.** Storage, display, exchange with partners the controller selects, publication the controller instructs, recall support, backups.
3. **Data and data subjects.** Staff and contact persons of the controller and its trading partners (names, business emails, phone numbers, roles); no special categories expected. Consumers are not data subjects of the records.
4. **Instructions.** We process only on documented instructions — the controller's use of the product (sharing, publishing, deleting) is an instruction.
5. **Confidentiality.** Personnel with access are bound by confidentiality; platform staff access to tenant data requires two-factor authentication and is audited.
6. **Security (Annex 1).** Implemented measures:
   - Tenant isolation enforced in the database (row-level security, non-owner runtime role) and tested on every API operation.
   - TLS for all traffic; HSTS; strict content security policy on public pages.
   - Evidence files private, downloaded through 5-minute signed links; malware scanning; SHA-256 integrity checks.
   - Append-only audit log and traceability events.
   - Backups encrypted before upload, stored off-site, point-in-time recovery; restore drills recorded.
   - Passport signing key held in a key-management service, non-exportable, with rotation.
   - Monitoring and alerting; incident response procedure.
7. **Sub-processors.** Listed in Annex 3; 30 days' notice of changes with a right to object.
8. **Breaches.** We notify the controller without undue delay and at the latest within [48] hours of becoming aware, with the information available, and support its notification duties.
9. **Assistance.** With data-subject requests (export and erasure tools), DPIAs, and authority requests.
10. **Deletion and return.** At the end of the service: export, then deletion per Annex 2 unless law requires storage.
11. **Audits.** Information on request; one audit per year with 30 days' notice.

**Annex 1:** security measures (section 6, kept current in `docs/security/threat-model.md`). **Annex 2:** data retention policy (`docs/compliance/data-retention.md`). **Annex 3:** sub-processors [hosting, backup storage, email].
