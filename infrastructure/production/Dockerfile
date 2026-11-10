# Casitrace application images (ADR 0015). Targets:
#   app     — API and worker (same image, different command), runs as non-root
#   migrate — applies Prisma migrations (needs the Prisma CLI)
#   web     — Caddy serving the built web app and reverse-proxying the API
ARG BUN_IMAGE=oven/bun:1.4.2-slim

FROM ${BUN_IMAGE} AS manifests
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/observability/package.json packages/observability/
COPY packages/shared/package.json packages/shared/

FROM manifests AS build
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN cd packages/db && bunx prisma generate
RUN cd apps/web && bunx vite build

FROM manifests AS prod-deps
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM prod-deps AS app
ENV NODE_ENV=production
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages packages
COPY scripts/ops scripts/ops
COPY --from=build /app/packages/db/src/generated packages/db/src/generated
USER bun
EXPOSE 3000 9464
CMD ["bun", "apps/api/src/main.ts"]

FROM build AS migrate
WORKDIR /app/packages/db
CMD ["bunx", "prisma", "migrate", "deploy"]

FROM caddy:2.10.2-alpine AS web
COPY infrastructure/production/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
