# Casitrace

Food traceability and evidence platform: trace any lot upstream and downstream across companies, back claims with evidence, and publish verifiable product pages.

- Plan: [`roadmap-v2.md`](roadmap-v2.md)
- Decisions: [`docs/adr/`](docs/adr/)
- Phase reports: [`docs/phases/`](docs/phases/)
- Contributor and agent rules: [`CLAUDE.md`](CLAUDE.md)

## Requirements

- Bun 1.4.2
- Docker with Compose v2

## Quick start

```sh
cp .env.example .env
docker compose up -d --wait && docker compose up s3-init   # first start: ClamAV needs 1-2 min
bun install
bun run db:setup
bun run dev
```

| URL | What |
|---|---|
| http://localhost:5173 | Web app |
| http://localhost:5173/api/docs | API docs (Swagger UI) |
| http://localhost:5173/api/ready | Readiness (database + storage) |
| http://localhost:8025 | Mailpit (captured email) |

## Checks

```sh
bun run lint
bun run typecheck
bun run test      # backend unit + integration against casitrace_test
bun run e2e       # Playwright smoke (first run: cd apps/web && bunx playwright install chromium)
```
