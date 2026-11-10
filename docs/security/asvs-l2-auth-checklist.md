# OWASP ASVS L2 — authentication and session subset (P2)

Self-assessment by the implementer on 2026-11-10. **Needs a second reviewer's sign-off** (roadmap-v2 P2 exit gate).
References follow ASVS 4.0.3 chapter numbering (V2 Authentication, V3 Session Management, V4 Access Control).

| Area | Requirement (summary) | Status | Evidence |
|---|---|---|---|
| V2.1 | Passwords ≥ 12 characters, up to 128, no composition rules | Met | `emailAndPassword.minPasswordLength/maxPasswordLength`; identity test "passwords shorter than 12…" |
| V2.1 | Breached-password check | **Not met** | Better Auth `haveibeenpwned` plugin available; deferred (needs outbound network policy) |
| V2.2 | Anti-automation: rate limiting and lockout | Met | DB-backed per-IP limits; 5-failure / 15-min account lockout incl. unknown emails; tests |
| V2.2 | MFA available; required for privileged users | Met | TOTP + backup codes; platform routes return `MFA_REQUIRED` without it; isolation test |
| V2.4 | Password storage with a slow, salted KDF | Met (library) | Better Auth default hashing (scrypt); no plaintext in exports (test) |
| V2.5 | Reset tokens: single use, short expiry, no account enumeration | Met | 30-min expiry; same response for unknown email (test); sessions revoked on reset (test) |
| V2.5 | Reset/verification links not retained | Met | Worker redacts outbox payload after sending (test) |
| V3.2 | Session tokens random, rotated on sign-in | Met (library) | Better Auth session tokens; new session per sign-in |
| V3.3 | Logout and reset invalidate sessions | Met | Tests "sign-out ends the session", "reset … revokes old sessions" |
| V3.3 | Absolute/idle timeouts | Met | 7-day expiry, daily refresh; 15-min freshness for sensitive actions |
| V3.4 | Cookies Secure, HttpOnly, SameSite, `__Secure-` prefix | Met | Test "session cookies are HttpOnly, Secure and SameSite=Lax" |
| V3.5 / V4.2.2 | CSRF defence on cookie-authenticated mutations | Met | Better Auth origin check (forced on); Hono `csrf` on /api/v1; no CORS; tests |
| V4.1 | Access control enforced server-side, deny by default | Met | `withAccess` guards; route-coverage gate fails on undeclared routes |
| V4.2 | No IDOR across tenants | Met | Isolation suite incl. Better Auth org endpoints; verified by an injected bug |
| V7.1 | No credentials or tokens in logs/audit | Met | Pino redaction; audit `safeBody` drops password/token/code/email fields; email hashed |
| V7.2 | Auth events logged | Met | Audit actions for sign-up/in/out, failures, lockout, reset, MFA, org/member changes |

## Open items before production (P9)

1. Breached-password check (V2.1).
2. The reverse proxy must overwrite `X-Forwarded-For`; otherwise per-IP rate limits can be bypassed by spoofing it.
3. Better Auth's auth audit records are written right after the change, not in the same transaction.
