# ADR 0014: API served under /api on the web origin

- **Status:** Accepted
- **Date:** 2026-11-10

## Context

Session cookies, CSRF origin checks and links in emails are simplest when the browser sees one origin. Better Auth also builds email links from a base URL.

## Decision

The API serves everything under `/api` on the web app's origin:
- `/api/health`, `/api/ready` — unversioned infrastructure checks.
- `/api/v1/...` — business routes; each declares `x-access` (public, user, org[:permission], platform:roles).
- `/api/v1/auth/...` — Better Auth.
- `/api/openapi.json`, `/api/docs`.

In development the Vite server proxies `/api` to the API (keeping the prefix, forwarding the client IP). In production a reverse proxy does the same. No CORS is enabled.

## Consequences

Cookies are first-party and `SameSite=Lax` works. The OpenAPI document declares `servers: [{ url: "/api" }]`, so generated clients use the right prefix. A separate API host would need CORS and cookie-domain work; not planned.
