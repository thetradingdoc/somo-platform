#!/usr/bin/env bash
# Upload local SQLite snapshot to prod GCS (Phase 1 post-cleanup).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUCKET="${GCS_DB_BUCKET:-somo-staging-db-somo-callsomo}"
OBJECT="${GCS_DB_OBJECT:-middleware-staging.db}"
SRC="${PHASE1_DB_PATH:-$ROOT/backups/middleware-staging.db}"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: DB not found: $SRC" >&2
  exit 2
fi

echo "==> Uploading ${SRC} → gs://${BUCKET}/${OBJECT}"
if command -v gcloud >/dev/null 2>&1; then
  gcloud storage cp "$SRC" "gs://${BUCKET}/${OBJECT}"
elif command -v gsutil >/dev/null 2>&1; then
  gsutil cp "$SRC" "gs://${BUCKET}/${OBJECT}"
else
  echo "ERROR: gcloud or gsutil not in PATH — install Google Cloud SDK or run: export PATH=\"/opt/homebrew/share/google-cloud-sdk/bin:\$PATH\"" >&2
  exit 127
fi
echo "OK: uploaded $(ls -lh "$SRC" | awk '{print $5}') to gs://${BUCKET}/${OBJECT}"
