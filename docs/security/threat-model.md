# Threat model (STRIDE) — P9

- **Date:** 2026-11-10 · **Scope:** authentication and sessions, public endpoints, evidence uploads, the passport signing key, and the production deployment (ADR 0015).
- **Method:** STRIDE per component; each threat rated High / Medium / Low (likelihood × impact for the pilot). **Every High finding is fixed** (roadmap P9 gate). Medium and Low findings are fixed or have a documented residual risk.
- **Review:** written by the implementer. A second reviewer must go through it before go-live (same as the ASVS checklist, `docs/security/asvs-l2-auth-checklist.md`).

## System and trust boundaries

```
Internet ──TLS──► Caddy (web) ──internal network──► API ──► Postgres (RLS, non-owner role)
                     │                              │  └──► OpenBao Transit (sign only)
                     │ static web app               │  └──► Object storage (private, presigned ≤ 15 min)
                     └ /api/metrics blocked         └──► outbox ──► Worker ──► ClamAV, SMTP
Phones / browsers (users, consumers scanning QR codes) are untrusted. Partners' organisations are
mutually untrusted tenants. Platform staff are trusted but audited.
```

Assets: tenant traceability data and evidence (confidential), public passports (integrity), the signing key (integrity of every published page), user accounts (personal data), audit log (integrity).

## Findings fixed in P9

| ID | Component | STRIDE | Rating | Threat | Fix | Proof |
|---|---|---|---|---|---|---|
| T-1 | Public endpoints | DoS / Spoofing | **High** | The public rate limiter keyed on the *leftmost* `X-Forwarded-For` entry, which the client controls: rotating fake addresses bypassed every public limit (scraping the directory, hammering pages). | Client address = the single value Caddy sets (Caddy replaces client-supplied values). Lists or malformed values share one "untrusted" bucket, the same rule Better Auth applies to sign-in. API unreachable except through Caddy. | `apps/api/src/platform/client-ip.ts`; `hardening.test.ts` "cannot escape its limit"; staging smoke test through Caddy |
| T-2 | Public endpoints | DoS | **High** | Limits were in memory per process: a second API instance or a restart reset them. | Shared fixed-window counters in Postgres (`rate_limit_bucket`, UNLOGGED, hashed keys, no IP stored). | `platform/rate-limit.ts`; `hardening.test.ts` "two API instances share one limit", "store holds no IP addresses" |
| T-3 | Signing key | Tampering / Spoofing | **High** | The Ed25519 private key was an environment variable on the application host: anyone reading the environment (debug dump, backup of the VM, compromised dependency) could forge passports indefinitely and undetectably. | Key generated inside OpenBao Transit, non-exportable; API signs through the KMS with AppRole; policy allows only `sign` and reading public keys; production refuses a local key or a static KMS token; every signature is verified locally before it is stored. | `transit-signer.ts`; `kms-signer.test.ts` (sign, rotate, export/delete/rotate/config denied); `env.test.ts` |
| T-4 | Public pages | Tampering (XSS) | Medium | Output is escaped, but there was no second line of defence if an escaping bug slipped in. | Strict CSP on public HTML: `default-src 'none'`, no scripts at all, stylesheet allowed by hash, `frame-ancestors 'none'`; the one inline `style=` attribute was removed. | `html.ts` `PUBLIC_HTML_CSP`; `hardening.test.ts` "strict CSP" |
| T-5 | Public pages | Information disclosure | Medium | Pages are cacheable (`public, max-age`) and negotiate language from `Accept-Language`, but sent no `Vary`: a shared cache could serve one language to everyone. | `Vary: Accept-Language` on public HTML; cache lifetime cut from 60 s to 30 s so a recall banner reaches cached pages well inside 1 minute. | `hardening.test.ts` |
| T-6 | Monitoring | Information disclosure | Medium | New metrics endpoints could reveal internals (routes, queue names, volumes). | Token required (constant-time compare; 404 otherwise); Caddy answers 404 for `/api/metrics`; labels are route *patterns*, never IDs. | `hardening.test.ts`, `retention-observability.test.ts` |
| T-7 | Web app (SPA) | Tampering (XSS, clickjacking) | Medium | The SPA had no CSP or framing protection. | Caddy sets CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS, nosniff, Referrer-Policy, Permissions-Policy. | `infrastructure/production/caddy/Caddyfile`; staging smoke test |
| T-8 | Backups | Information disclosure | Medium | Database backups contain all tenant data and personal data. | WAL-G encrypts client-side (libsodium) before upload; backup storage at a different provider/region; key held offline. | `compose.yml` `x-walg-env`; restore drill |

## Threats reviewed by component

### Authentication and sessions (Better Auth, ADR 0009)

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Credential stuffing / brute force | Better Auth rate limits (DB store, shared), lockout after failed attempts (P2), TOTP available; staff must use TOTP | Low |
| S | Session theft | `__Secure-` cookies, HttpOnly, SameSite=Lax, 7-day expiry, fresh-session requirement for sensitive actions; HSTS | Low |
| T | CSRF | Origin checks forced on (also in tests), Hono `csrf` on `/api/v1`, no CORS | Low |
| R | Denying an action | Every command writes an append-only audit row (trigger + revoked UPDATE/DELETE) | Low |
| I | Account enumeration via sign-up / reset | Rate limited; reset answers the same for unknown emails. Sign-up reveals an existing address (Better Auth behaviour) | **Medium, accepted for pilot** (closed invite-based onboarding) |
| D | Sign-up flood / email bombing | Rate limits per IP; email jobs queued | Low |
| E | Cross-tenant access | RLS on every tenant table, non-owner runtime role, isolation suite attacks every operation | Low |

### Public endpoints (`/p`, `/01`, `/o`, `/directory`, `/api/v1/public/*`)

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Fake passport pages (phishing look-alikes) | Signatures verifiable by anyone (`/api/public/keys`, `scripts/verify-passport.mjs`); page shows verification state | Medium (look-alike domains are outside our control) |
| T | Altering a published passport | Versions immutable (trigger + revoke), digest + Ed25519 signature checked on every page render | Low |
| I | Private data on public pages | Strict snapshot schema, disclosure decisions, test scanning all public responses for private values | Low |
| I | Enumerating public IDs | 10 random characters (~49 bits) + rate limits | Low |
| D | Request floods | Shared rate limits, Caddy timeouts, small pages, CDN-cacheable; no WAF | **Medium** — a volumetric attack would take the single VM down; mitigation is a CDN/WAF in front (deferred, runbook step) |

### Evidence uploads

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| T | Malware distributed through evidence | ClamAV scan before download is allowed; infected objects deleted; only `clean` downloadable | Low (signature-based AV misses novel malware) |
| T | Type confusion (HTML/SVG uploaded as PDF) | Type sniffed from bytes against an allow-list (no HTML/SVG); downloads are served by the storage origin through presigned URLs, never from the app origin | Low |
| D | Huge or compressed bombs | 25 MB body limit before parsing; ClamAV scan limits | Low |
| T | Path traversal / overwrites | Storage keys generated server-side; objects never overwritten | Low |
| I | Presigned link leaked | 5-minute links, per-download audit, private bucket | Low |

### Signing key and KMS

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Attacker signs pages via the KMS from a compromised API host | AppRole token short-lived (1 h); OpenBao audit log of every sign; key rotation runbook lists versions signed in a window | **Medium** (ADR 0015 consequence; separate KMS host is the upgrade) |
| T | Old passports invalid after rotation | All key versions published with status; local-era keys kept in `PASSPORT_PREVIOUS_KEYS`; tested | Low |
| D | KMS sealed after restart → no publishing | Publishing fails loudly; public pages and verification keep working (verification is local); unseal runbook | Low |
| E | Operator token misuse | Root token revoked after bootstrap; rotation uses a separate `key-operator` token; unseal shares split across custodians | Low |

### Deployment

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| E | Container escape / privilege | App runs as non-root `bun`; only Caddy publishes a port; Postgres, KMS, metrics on internal network | Low |
| T | Supply chain (dependencies, images) | Lockfile, exact versions ≥ 2 weeks old, `bun audit` (0 known vulnerabilities on 2026-11-10), images pinned by tag, WAL-G pinned by SHA-256 | Medium (tags are mutable; pin digests at release) |
| I | Secrets in the repository | `.env` files git-ignored; production refuses development keys and static tokens | Low |
| D | Single VM failure | Backups + measured restore (RTO), external uptime monitor | Medium (ADR 0015) |

## Open items for go-live

1. Second-reviewer pass on this document and on the ASVS checklist.
2. Pin image digests in the release process (`docker buildx imagetools inspect`).
3. Decide on a CDN/WAF in front of Caddy when the hosting provider is chosen (T-D public endpoints).
4. Re-run `bun audit` weekly in CI (NFR: no critical/high CVEs open > 7 days) — added to CI in P9.
