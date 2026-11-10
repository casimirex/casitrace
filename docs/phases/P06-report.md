# Phase report — P6 Cross-organisation exchange

- **Date:** 2026-11-10
- **Status:** Complete, pending review. All three exit gates pass locally.

## Exit gates

| Gate | Status | Evidence |
|---|---|---|
| 3-org E2E (producer → processor → retailer): full trace where grants exist, redacted nodes where not | Pass | `apps/web/e2e/exchange.e2e.ts` (browser, three separate sessions) and `apps/api/tests/exchange.test.ts`. Retailer sees the mill's history (shared on shipment) and the grower as a redacted node; after the grower shares with all downstream holders the harvest appears; after the mill stops sharing its part is redacted again. |
| Isolation suite extended to grants; revoking removes access immediately | Pass | 81 operations attacked by the route-coverage suite; exchange tests cover an unrelated fourth organisation (no handoffs, grants, shared evidence or traces), grantee cannot revoke, sender cannot accept its own shipment, revocation effective on the next request. Injecting a bug (ignoring revocation) made the suite fail; reverted. |
| Dispute flow tested | Pass | Receiver disputes with a reason; sender sees it; sender voids the shipment; handoff becomes cancelled and can no longer be accepted. |

## Built

**Database** (migrations `exchange`, `organization_profile_public`)
- `handoff`, `cross_lot_link` (append-only), `sharing_grant` (revoked, never deleted), `shared_access` (append-only), `evidence_request`, `supplier_requirement`, `partner_claim`; trading partners gain approval status.
- Two-party RLS; a view exposing only each organisation's verification status.

**API** (24 new operations, 81 total)
- Handoffs: list, detail, accept (books a RECEIVE in the receiver's records, maps lots to its own products, GTIN suggestions in the UI, creates the cross-organisation links, adds the sender as a supplier partner), dispute. SHIP to an on-platform customer creates the handoff and can share history (`share` option).
- Grants: list given/received with usage counts, create (specific organisation or every downstream holder; upstream/downstream depth; include KDEs), revoke, access log.
- Cross-organisation trace and CSV report (other organisations' KDEs only when their grant includes them; NOT_SHARED rows otherwise).
- Evidence requests: create (suppliers on Casitrace only), fulfil by sharing own evidence, decline, cancel; notifications and email to the other side.
- Shared evidence: view and download through an active grant, logged on both sides and in the grantor's audit log.
- Supplier requirements, compliance view (own evidence linked to the partner, or verified evidence shared by the supplier), approve (refused while anything is missing) and suspend.
- Partner claims: invitation email with a single-use 14-day token (hash stored), accepted only by the invited, verified address on behalf of an organisation the user owns/administers; earlier shipments (12 months) become pending handoffs.

**Web**
- Shipments tab (incoming with accept/dispute, outgoing with status), Sharing tab (shared by you / with you, stop sharing, document requests), shared document page, partner page (requirements checklist, approve/suspend, invitation), claim page, supplier requirements on the Partners page, share option on the Ship form, trace diagram and table showing the holding organisation and redacted parts.

## Test results (local)

| Suite | Result |
|---|---|
| Lint / typecheck / build | Pass |
| Backend + worker | 141 pass, 0 fail |
| E2E | 10 pass, twice in a row |

## Decisions

- A redacted node shows the organisation's name and verification status. The viewer already knows its direct trading partners; deeper unshared organisations are revealed by name only when reached through a shared segment.
- Lot codes printed on a delivery remain the receiver's information after revocation (they are on its own receipt); revocation hides the sender's records behind the shipment.
- "Verified" on shared evidence means verified by the supplier's own reviewer; the buyer's compliance view labels the source.
- Accepting a shipment requires booking in every shipped lot; partial receipts go through a dispute.

## Known limitations

1. No UI yet to create a lot grant from the lot page (API exists; sharing on shipment covers the common case).
2. Forward visibility beyond a customer requires that customer's grant; recall reach (P8) will depend on it.
3. Claimed partners' own earlier shipments to the inviter are not linked retroactively (only the inviter's shipments to them).
4. Grant scope is per lot; there is no "share everything with this partner" setting.
5. CI has still not run on GitHub (no remote).

## Next: P7 — Public layer

Product passports (versioned, signed snapshots with a disclosure policy), QR codes on GS1 Digital Link URLs, public product and organisation pages, public verification endpoint.
