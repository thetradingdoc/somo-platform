#!/usr/bin/env bash
# Stream CMS NPPES V2 monthly zip into SQLite, then normalize/prune rows.
# Requires: unzip, ~1.1GB zip under data/nppes/
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ZIP=$(ls -t "$ROOT"/data/nppes/NPPES_Data_Dissemination_*_V2.zip 2>/dev/null | head -1 || true)
if [[ -z "${ZIP}" ]]; then
  echo "No NPPES_Data_Dissemination_*_V2.zip in data/nppes. Download from https://download.cms.gov/nppes/NPI_Files.html" >&2
  exit 1
fi

MEMBER=$(unzip -Z1 "$ZIP" | grep -E '^npidata_pfile_.*\.csv$' | grep -v fileheader | head -1)
if [[ -z "${MEMBER}" ]]; then
  echo "Could not find npidata_pfile_*.csv inside $ZIP" >&2
  exit 1
fi

export DB_PATH="${DB_PATH:-./middleware-dev.db}"
export POSTGRES_URL="${POSTGRES_URL:-}"

echo "NPPES full import: zip=$(basename "$ZIP") member=$MEMBER -> DB_PATH=$DB_PATH"
echo "Tip: stop npm start / DB browsers using this file, or set SQLITE_BUSY_TIMEOUT_MS=120000 (see database.js)."
unzip -p "$ZIP" "$MEMBER" | node "$ROOT/scripts/import-nppes-directory.cjs" --stdin
node "$ROOT/scripts/nppes-directory-clean.cjs"
echo "Done. Row count:"
cd "$ROOT" && node -e "const Database=require('better-sqlite3');const db=new Database(process.env.DB_PATH||'./middleware-dev.db');console.log(db.prepare('SELECT COUNT(*) AS c FROM nppes_directory_providers').get());db.close();"
