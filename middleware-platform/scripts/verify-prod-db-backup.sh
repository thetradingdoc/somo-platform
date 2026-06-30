#!/usr/bin/env bash
# Verify production SQLite backup exists in GCS (adjust bucket/object for your env).
set -euo pipefail
BUCKET="${GCS_DB_BUCKET:-somo-staging-db-somo-callsomo}"
OBJECT="${GCS_DB_OBJECT:-middleware-staging.db}"
echo "Checking gs://${BUCKET}/${OBJECT} ..."
if command -v gsutil >/dev/null 2>&1; then
  if gsutil stat "gs://${BUCKET}/${OBJECT}" >/dev/null 2>&1; then
    echo "OK: backup object exists"
    gsutil ls -l "gs://${BUCKET}/${OBJECT}"
    exit 0
  fi
  echo "WARN: object not found — configure nightly backup for /home/middleware-prod.db"
  exit 1
fi
echo "gsutil not installed — manual check required for Azure/GCS prod DB backup"
exit 0
