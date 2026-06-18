#!/bin/bash
# DEPRECATED — use repo root: ./run  (→ scripts/dev/run.sh)
# This script does not set DB_PATH or DEV_LIGHT_START.
echo "⚠️  start.sh is deprecated. Use: ./run  (from repo root)" >&2
exec "$(cd "$(dirname "$0")/.." && pwd)/scripts/dev/run.sh"
