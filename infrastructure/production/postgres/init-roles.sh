#!/bin/sh
# First start of an empty data directory only. Creates the runtime role with a login (ADR 0008):
# not an owner, no RLS bypass. Migrations (run as the owner) grant it table privileges.
set -eu
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" -v db="$POSTGRES_DB" <<'SQL'
CREATE ROLE casitrace_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT, CREATE ON DATABASE :"db" TO casitrace_app;
SQL
