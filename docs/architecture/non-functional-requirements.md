# Non-functional requirements (MVP)

Source: roadmap-v2.md §3. These numbers are test targets; a change needs an ADR.

| Area                | Requirement                                                                 | Verified by              | Phase     |
| ------------------- | --------------------------------------------------------------------------- | ------------------------ | --------- |
| Trace query latency | Backward/forward trace, 10 hops / 5,000 lots: p95 < 2 s                     | Load test on seeded data | P5, P9    |
| Trace report        | Sortable CSV of all KDEs for a lot's chain; target < 1 min, hard limit 24 h | E2E test                 | P5        |
| Public page         | Passport TTFB p95 < 500 ms (cached); core data readable without JS          | Load test, Lighthouse    | P7        |
| Availability        | 99.5 % monthly during the pilot                                             | Uptime monitor           | P9        |
| Durability          | RPO ≤ 24 h, RTO ≤ 4 h; restore drill recorded                               | Drill log                | P9        |
| Tenant isolation    | 0 cross-tenant reads or writes across every route                           | CI isolation suite       | P2 onward |
| Audit               | 100 % of state-changing commands write an audit record                      | Integration tests        | P1 onward |
| Security            | OWASP ASVS L2 for auth and sessions; no critical/high CVE open > 7 days     | Review, CI scan          | P2, P9    |
| Privacy             | GDPR export and erasure for user accounts; DPA template                     | Checklist, tests         | P2, P9    |
| Accessibility       | WCAG 2.2 AA on public pages and capture forms                               | axe in Playwright        | P5, P7    |
| Field capture       | Usable on a mid-range phone over 3G; offline queue for harvest/receive      | Device test              | P5        |
| i18n                | 2 languages on public pages at pilot                                        | E2E                      | P7        |

## Status at the end of P9 (2026-11-10)

| Area | Status | Evidence |
|---|---|---|
| Trace query latency | **Met** over HTTP on the production build | `docs/operations/load-tests/2026-11-10-staging.json` (5,000 lots / 10 levels seeded through the API) and `traceability-performance.test.ts` |
| Trace report | Met | P5 E2E |
| Public page | **Met** uncached on the production build (stricter than the "cached" target); Lighthouse mobile: performance 100, accessibility 100 | Load test report; P09 report |
| Availability | **Not yet measurable**: needs the production VM and the external uptime monitor for a month (pilot) | Uptime monitor (go-live checklist) |
| Durability | **Met on staging** (RTO 36 s, RPO ≤ 60 s by WAL archiving); must be repeated on the production VM | `docs/operations/restore-drills/2026-11-10-staging.md` |
| Tenant isolation | Met | CI isolation suite (every operation) |
| Audit | Met | Integration tests |
| Security | ASVS L2 checklist pending second reviewer; `bun audit` 0 known vulnerabilities, now a CI gate; STRIDE threat model with all High findings fixed | `docs/security/` |
| Privacy | Export/erasure met (P2); retention automated where applicable; DPA, privacy policy drafts need legal review | `docs/legal/`, `docs/compliance/data-retention.md` |
| Accessibility | Met by axe on public pages and capture forms | E2E |
| Field capture | Offline queue met (P5); 3G check by Lighthouse simulation; **real-device test pending** in the pilot | P05/P07 reports |
| i18n | Met with Italian as a placeholder for the pilot language | E2E |
