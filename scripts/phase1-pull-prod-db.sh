#!/usr/bin/env bash
# Pull prod GCS SQLite for Phase 1 live verify scripts.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUCKET="${GCS_DB_BUCKET:-somo-staging-db-somo-callsomo}"
OBJECT="${GCS_DB_OBJECT:-middleware-staging.db}"
DEST="${PHASE1_DB_PATH:-$ROOT/backups/middleware-staging.db}"
mkdir -p "$(dirname "$DEST")"
echo "==> Pulling gs://${BUCKET}/${OBJECT} → ${DEST}"
rm -f "${DEST}" "${DEST}_.gstmp"
if command -v gcloud >/dev/null 2>&1; then
  gcloud storage cp "gs://${BUCKET}/${OBJECT}" "$DEST"
else
  gsutil -o "GSUtil:parallel_process_count=1" cp "gs://${BUCKET}/${OBJECT}" "$DEST"
fi
if command -v sqlite3 >/dev/null 2>&1; then
  INTEGRITY="$(sqlite3 "$DEST" "PRAGMA integrity_check;" 2>&1 | head -1)"
  if [ "$INTEGRITY" != "ok" ]; then
    echo "❌ SQLite integrity_check failed: $INTEGRITY"
    exit 1
  fi
  echo "✅ SQLite integrity_check: ok"
fi
echo "OK: $(ls -lh "$DEST" | awk '{print $5, $9}')"
export DB_PATH="$DEST"
echo "export DB_PATH=$DEST"
