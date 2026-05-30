#!/usr/bin/env bash
# Wrapper — implementation in cloudrun-db-sync.cjs (@google-cloud/storage).
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/cloudrun-db-sync.cjs "$@"
