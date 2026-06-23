#!/usr/bin/env bash
# Stream CMS NPPES V2 into SQLite (nppes_directory_providers), then normalize/prune.
# Requires: unzip (when using zip), or an extracted npidata_pfile_*.csv under the canonical tree.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SOURCES_ROOT="${PAYOR_DATA_SOURCES_ROOT:-$ROOT/data/payor-sources}"
NPPES_DIR="$SOURCES_ROOT/nppes"

ZIP=""
if [[ -n "${NPPES_ZIP_PATH:-}" ]] && [[ -f "${NPPES_ZIP_PATH}" ]]; then
  ZIP="${NPPES_ZIP_PATH}"
else
  ZIP="$(ls -t "$NPPES_DIR"/NPPES_Data_Dissemination_*_V2.zip 2>/dev/null | head -1 || true)"
fi

CSV=""
if [[ -z "${ZIP}" ]]; then
  CSV="$(node -e "const { findPreferredNppesCsvPath } = require('./payor/payor-data-sources'); const p = findPreferredNppesCsvPath(); process.stdout.write(p || '');")"
fi

export DB_PATH="${DB_PATH:-./middleware-dev.db}"
export POSTGRES_URL="${POSTGRES_URL:-}"

if [[ -n "${ZIP}" ]]; then
  MEMBER=$(unzip -Z1 "$ZIP" | grep -E '^npidata_pfile_.*\.csv$' | grep -v fileheader | head -1)
  if [[ -z "${MEMBER}" ]]; then
    echo "Could not find npidata_pfile_*.csv inside $ZIP" >&2
    exit 1
  fi
  echo "NPPES full import: zip=$(basename "$ZIP") member=$MEMBER -> DB_PATH=$DB_PATH"
  echo "Tip: stop npm start / DB browsers using this file, or set SQLITE_BUSY_TIMEOUT_MS=120000 (see database.js)."
  unzip -p "$ZIP" "$MEMBER" | node "$ROOT/scripts/data/import-nppes-directory.cjs" --stdin
elif [[ -n "${CSV}" ]] && [[ -f "${CSV}" ]]; then
  echo "NPPES full import: csv=$(basename "$CSV") dir=$NPPES_DIR -> DB_PATH=$DB_PATH"
  echo "Tip: stop npm start / DB browsers using this file, or set SQLITE_BUSY_TIMEOUT_MS=120000 (see database.js)."
  node "$ROOT/scripts/data/import-nppes-directory.cjs" "$CSV"
else
  echo "No NPPES input found under: $NPPES_DIR" >&2
  echo "Expected either:" >&2
  echo "  - NPPES_Data_Dissemination_*_V2.zip in that directory, or" >&2
  echo "  - extracted dissemination folder (npidata_pfile_*.csv), or symlink via:" >&2
  echo "    npm run setup:payor-data-sources:link-nppes -- /path/to/NPPES_Data_Dissemination_*_V2" >&2
  echo "Override: NPPES_ZIP_PATH=/path/to/file.zip or PAYOR_DATA_SOURCES_ROOT=..." >&2
  exit 1
fi

node "$ROOT/scripts/nppes-directory-clean.cjs"
echo "Done. Row count:"
cd "$ROOT" && node -e "const Database=require('better-sqlite3');const db=new Database(process.env.DB_PATH||'./middleware-dev.db');console.log(db.prepare('SELECT COUNT(*) AS c FROM nppes_directory_providers').get());db.close();"
