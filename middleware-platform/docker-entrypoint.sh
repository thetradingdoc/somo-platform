#!/usr/bin/env bash
set -euo pipefail
cd /app
chmod +x docker-entrypoint.sh scripts/cloudrun-db-sync.sh 2>/dev/null || true
exec ./scripts/cloudrun-db-sync.sh serve node server.js
