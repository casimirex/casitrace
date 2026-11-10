#!/usr/bin/env bash
# Runs scripts/load-test.ts against the staging rehearsal from inside its Docker network, so each
# simulated visitor has its own client address (as real phones scanning QR codes do). The report is
# written to docs/operations/load-tests/<date>-staging.json.
#   infrastructure/production/load-test.sh [extra load-test args]
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
OUT="$ROOT/docs/operations/load-tests"
mkdir -p "$OUT"
WEB_ORIGIN=$(grep '^WEB_ORIGIN=' .env.staging | cut -d= -f2-)
docker run --rm --user "$(id -u):$(id -g)" --network casitrace-staging_internal -v "$ROOT/scripts:/scripts:ro" -v "$OUT:/out" -w /out \
  oven/bun:1.4.2-slim bun /scripts/load-test.ts http://api:3000 --mailpit http://mailpit:8025 --origin "$WEB_ORIGIN" "$@"
mv "$OUT/load-test-report.json" "$OUT/$(date -u +%F)-staging.json"
echo "report: $OUT/$(date -u +%F)-staging.json"
