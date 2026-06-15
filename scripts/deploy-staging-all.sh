#!/usr/bin/env bash
set -euo pipefail

# Full production deploy (local): API (Cloud Run) + UI (Firebase) + smoke.
# Prefer: npm run deploy:callsomo
# Usage: ./scripts/deploy-staging-all.sh [--skip-ci] [--skip-api] [--skip-ui] [--skip-smoke]

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/deploy-callsomo-local.sh" "$@"
