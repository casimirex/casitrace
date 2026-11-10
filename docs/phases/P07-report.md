# Phase report — P7 Public layer: passport, QR, directory

- **Date:** 2026-11-10
- **Status:** Complete, pending review. Three of four exit gates pass; Lighthouse was not run (axe was).

## Exit gates

| Gate | Status | Evidence |
|---|---|---|
| Printed QR → phone → correct page in < 2 s on 4G | Pass (emulated) | `apps/web/e2e/public.e2e.ts`: the QR payload (`/01/08001234560034/10/B500-OPEN-1`) opened in a mobile context with JavaScript off and Chrome network emulation (70 ms latency, 9 Mbit/s down): resolver redirect + page load **222 ms**. The QR SVG is checked to encode that payload (`x-qr-payload`); the image itself was not decoded by a scanner and no physical print/phone test was done. |
| No private field in any public response | Pass | `publication.test.ts`: the public snapshot is parsed with a strict schema (any extra field fails), and every public response (passport JSON, verify, HTML in two languages, directory, organisation JSON and HTML) is scanned for seeded private values: supplier and customer names, registration and VAT numbers, internal notes, a lab report, a location address line, partner email, lot quantities. Each disclosure switch removes its section. |
| Signature verified by an independent script using only the public key | Pass | `scripts/verify-passport.mjs` (Node built-ins only) fetches the passport and `/api/v1/public/keys` and checks canonical form, SHA-256 and Ed25519 signature; a tampered copy is rejected (exit 1). |
| Lighthouse / axe pass | **axe pass; Lighthouse not run** | axe (WCAG 2.0/2.1/2.2 A+AA rules) reports 0 violations on the passport page and the directory. Lighthouse needs a separate runner; to add in P9 with the production build. |

## Built

**Database** (migration `publication`)
- `passport` (product or lot scope, short public ID, disclosure policy, status draft/published/withdrawn), `passport_version` (append-only: canonical JSON, digest, signature, key ID, GTIN-14 and lot code for resolution).
- Views `public_passport_version` (published/withdrawn versions only) and `public_directory` (opted-in organisations, directory fields only). Profile gains `public_listing`.

**API** (18 new operations, 99 total)
- Organisation: list, create (from a lot or product), get, preview (exactly what would be published), disclosure, publish (new signed version), withdraw, QR SVG.
- Public (no account): signing keys (current + previous), passport JSON with live status (latest version, withdrawn, recall, current certificate status), verify, directory search (query ≥ 2 characters, 50 results), organisation JSON; server-rendered HTML for the passport, directory and organisation pages (English and Italian, no JavaScript); GS1 Digital Link resolver for `/01/{gtin}` and `/01/{gtin}/10/{lot}` (falls back to the product page).
- Rate limits per IP on all public endpoints; short public caching.

**Passport content** (olive oil)
- Product (name, grade, cultivars, size, container, organic as *declared*, origin, GTIN, storage), producer (name, verified flag, town/region/country), lot (code, best-before, harvest period, milling date, extraction method, "cold extracted" derived from malaxation ≤ 27 °C), origin areas rounded to 0.1°, journey steps, certificates with status and file SHA-256.
- Upstream data from other organisations only where they shared it with key data elements (P6 grants).
- The page states plainly that a signature proves the page is unchanged, not that every claim is true.

**Signing**
- Ed25519 over canonical JSON; key ID from the public key; previous keys published so old versions verify after rotation (tested). Development key committed for local use and refused when `NODE_ENV=production`. `bun run keys:generate` creates a production key.

**Web**
- "Public pages" tab; "Create public page" on lot and product pages; passport page with disclosure switches, preview, publish/withdraw, versions, QR image + SVG download and the public link; directory opt-in on the profile.

## Test results (local)

| Suite | Result |
|---|---|
| Lint / typecheck / build | Pass |
| Backend + worker | 155 pass, 0 fail |
| E2E | 11 pass, twice in a row |

## Decisions and deviations

- Public pages are server-rendered by the API instead of the React app: readable without JavaScript, fast (no bundle), and no client code can leak private data.
- The second public language is Italian as a placeholder for the pilot country (ADR 0002 still open).
- No map tiles are embedded (privacy and CSP); the page links to OpenStreetMap at the rounded coordinates.
- Rate limiting is in memory (one API instance); a shared store is needed before scaling out (P9).
- Browser-test robustness: email waits raised to 30 s (the worker's queue is slower when the whole suite runs in parallel), and test organisation names made unique because E2E uses the persistent dev database.

## Known limitations

1. Lighthouse not run; QR not tested with a physical scanner.
2. The page's "verified" producer badge reflects Casitrace's business verification; third-party attestations are P10.
3. A lot passport does not update automatically when the lot changes; publish a new version (old versions stay verifiable).
4. GTIN uniqueness is per organisation; if two organisations publish the same GTIN, the resolver picks the newest page.
5. The signing key lives in an environment variable; KMS integration is P9.

## Next: P8 — Recall and incident handling

Recall cases from lots, impact via forward trace (across organisations where shared), notifications and acknowledgements, holds/recall status, passport banner (already wired to `recalled`), mock-recall drill with timing.
