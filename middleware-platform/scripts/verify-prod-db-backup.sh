#!/usr/bin/env bash
# Verify production SQLite backup exists in GCS (prefers backups/ prefix; falls back to legacy object).
set -euo pipefail
BUCKET="${GCS_DB_BUCKET:-somo-staging-db-somo-callsomo}"
LEGACY_OBJECT="${GCS_DB_OBJECT:-middleware-staging.db}"
PREFIX="gs://${BUCKET}/backups/"

echo "Checking ${PREFIX} ..."
if command -v gsutil >/dev/null 2>&1; then
  if gsutil ls "${PREFIX}" 2>/dev/null | head -1 | grep -q .; then
    echo "OK: backups/ prefix has objects"
    gsutil ls -l "${PREFIX}" | tail -5
    exit 0
  fi
  echo "WARN: backups/ empty — trying legacy gs://${BUCKET}/${LEGACY_OBJECT}"
  if gsutil stat "gs://${BUCKET}/${LEGACY_OBJECT}" >/dev/null 2>&1; then
    echo "OK: legacy backup object exists"
    gsutil ls -l "gs://${BUCKET}/${LEGACY_OBJECT}"
    exit 0
  fi
  echo "WARN: no backup found — configure nightly backup for production DB"
  exit 1
fi
echo "gsutil not installed — manual check required"
exit 0
