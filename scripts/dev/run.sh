#!/usr/bin/env bash
# Canonical local dev entry — light profile, DB under middleware-platform/var/db/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MP="$ROOT/middleware-platform"
cd "$MP"

mkdir -p var/db var/db/archive

DEV_DB="var/db/middleware-dev.db"

# One-time migration from legacy package-root DB
if [[ ! -f "$DEV_DB" && -f middleware-dev.db ]]; then
  echo "→ Moving middleware-dev.db to var/db/"
  mv middleware-dev.db "$DEV_DB"
  for ext in -wal -shm; do
    [[ -f "middleware-dev.db${ext}" ]] && mv "middleware-dev.db${ext}" "var/db/" || true
  done
fi

# Archive duplicate package-root DBs when canonical var/db copy exists
stamp="$(date +%Y%m%d-%H%M%S)"
for legacy in middleware-dev.db middleware-audit.db; do
  if [[ -f "$legacy" ]]; then
    if [[ -f "$DEV_DB" && "$legacy" == "middleware-dev.db" ]]; then
      echo "→ Archiving legacy package-root DB: $legacy → var/db/archive/${legacy}.${stamp}"
      mv "$legacy" "var/db/archive/${legacy}.${stamp}" 2>/dev/null || true
      for ext in -wal -shm; do
        [[ -f "${legacy}${ext}" ]] && mv "${legacy}${ext}" "var/db/archive/${legacy}.${stamp}${ext}" 2>/dev/null || true
      done
    elif [[ "$legacy" == "middleware-audit.db" && ! -f "var/db/middleware-audit.db" ]]; then
      echo "→ Moving middleware-audit.db to var/db/"
      mv "$legacy" var/db/middleware-audit.db
      for ext in -wal -shm; do
        [[ -f "${legacy}${ext}" ]] && mv "${legacy}${ext}" var/db/ || true
      done
    elif [[ "$legacy" == "middleware-audit.db" && -f "var/db/middleware-audit.db" ]]; then
      echo "→ Archiving legacy package-root DB: $legacy → var/db/archive/${legacy}.${stamp}"
      mv "$legacy" "var/db/archive/${legacy}.${stamp}" 2>/dev/null || true
    fi
  fi
done

# Archive stale repo-root copies (split-brain)
for f in "$ROOT/middleware-dev.db" "$ROOT/middleware-test.db"; do
  if [[ -f "$f" ]]; then
    base="$(basename "$f")"
    stamp="$(date +%Y%m%d-%H%M%S)"
    echo "→ Archiving stale root DB: $f → var/db/archive/${base}.${stamp}"
    mv "$f" "var/db/archive/${base}.${stamp}" 2>/dev/null || true
    for ext in -wal -shm; do
      [[ -f "${f}${ext}" ]] && mv "${f}${ext}" "var/db/archive/${base}.${stamp}${ext}" 2>/dev/null || true
    done
  fi
done

export DB_PATH=./var/db/middleware-dev.db
export DEV_LIGHT_START="${DEV_LIGHT_START:-1}"
export CATALOG_MASTER_SYNC_ENABLED="${CATALOG_MASTER_SYNC_ENABLED:-0}"
export EHR_SYNC_ENABLED="${EHR_SYNC_ENABLED:-0}"
export NOTIFICATION_QUEUE_ENABLED="${NOTIFICATION_QUEUE_ENABLED:-0}"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
elif command -v brew >/dev/null 2>&1 && [[ -s "$(brew --prefix nvm 2>/dev/null)/nvm.sh" ]]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  source "$(brew --prefix nvm)/nvm.sh"
fi

echo "📁 DB_PATH=$DB_PATH"
echo "🚀 Starting middleware (DEV_LIGHT_START=$DEV_LIGHT_START)…"
exec npm start
