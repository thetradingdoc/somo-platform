#!/usr/bin/env bash
# Local replacement for .github/workflows/kelly-rails-prod-nightly.yml.disabled
# Run manually or via cron: 0 7 * * * cd /path/to/somo && npm run verify:kelly:nightly
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MP="$ROOT/middleware-platform"
DB_PATH="${DB_PATH:-$MP/tmp/nightly-prod.db}"

cd "$MP"
mkdir -p tmp

echo "==> Download prod DB snapshot (optional)"
node scripts/cloudrun-db-sync.cjs download || echo "DB download skipped — set GCS credentials"

echo "==> Production env gates"
CLOUDRUN_PROFILE=production CONVERSATION_MODE_ROUTING=enforce KELLY_ALLOW_HYBRID_GRAPH=0 npm run verify:env-gates

echo "==> Kelly Rails prod runtime (requires DB snapshot)"
if [[ -f "$DB_PATH" ]]; then
  DB_PATH="$DB_PATH" KELLY_RUNTIME_CHECK_HOURS=24 npm run verify:kelly-rails-prod-runtime
  DB_PATH="$DB_PATH" npm run verify:orchestration-trace
  DB_PATH="$DB_PATH" npm run verify:gcs-sqlite-contention || true
else
  echo "No DB at $DB_PATH — runtime DB checks skipped"
fi

GCP_PROJECT=somo-callsomo npm run verify:kelly-rails-cloudrun

echo "==> Slow CI tier (live spine + coding DB gates)"
cd "$ROOT"
npm run ci:slow

echo "✅ Kelly nightly verify complete"
