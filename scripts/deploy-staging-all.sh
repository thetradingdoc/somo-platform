#!/usr/bin/env bash
set -euo pipefail

# Full staging deploy: API (Cloud Run) + UI (Firebase) + smoke.
# Usage: ./scripts/deploy-staging-all.sh [--skip-ci] [--skip-api] [--skip-ui]

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_CI=0
SKIP_API=0
SKIP_UI=0
for arg in "$@"; do
  case "$arg" in
    --skip-ci) SKIP_CI=1 ;;
    --skip-api) SKIP_API=1 ;;
    --skip-ui) SKIP_UI=1 ;;
  esac
done

if [[ "$SKIP_CI" -eq 0 ]]; then
  echo "==> Pre-deploy checks (subset)..."
  node scripts/build-staging-hosting.cjs
  node scripts/verify-staging-hosting.cjs
fi

if [[ "$SKIP_API" -eq 0 ]]; then
  echo "==> Deploy API to Cloud Run..."
  CLOUDRUN_PROFILE=staging ./scripts/deploy-to-gcp.sh
fi

if [[ "$SKIP_UI" -eq 0 ]]; then
  echo "==> Deploy UI to Firebase..."
  npm run deploy:staging-hosting
fi

echo "==> Post-deploy smoke..."
npm run smoke:staging

echo "==> Staging deploy complete."
