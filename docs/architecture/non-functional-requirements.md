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
