#!/usr/bin/env bash
# Pull prod GCS SQLite for Phase 1 live verify scripts.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUCKET="${GCS_DB_BUCKET:-somo-staging-db-somo-callsomo}"
OBJECT="${GCS_DB_OBJECT:-middleware-staging.db}"
DEST="${PHASE1_DB_PATH:-$ROOT/backups/middleware-staging.db}"
mkdir -p "$(dirname "$DEST")"
echo "==> Pulling gs://${BUCKET}/${OBJECT} → ${DEST}"
gsutil cp "gs://${BUCKET}/${OBJECT}" "$DEST"
echo "OK: $(ls -lh "$DEST" | awk '{print $5, $9}')"
export DB_PATH="$DEST"
echo "export DB_PATH=$DEST"
