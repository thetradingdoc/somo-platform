#!/usr/bin/env bash
# Ship customer-ready P0–P2 to production (run after merge to main).
# Requires: gcloud auth login, firebase login --reauth
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_TESTS="${SKIP_TESTS:-0}"
SKIP_AUTH="${SKIP_AUTH:-0}"

if [[ "$SKIP_AUTH" != "1" ]]; then
  echo "==> 1. Auth (skip with SKIP_AUTH=1 if already logged in)"
  if ! gcloud auth print-access-token >/dev/null 2>&1; then
    gcloud auth login
  fi
  gcloud config set project somo-callsomo
  if ! firebase projects:list >/dev/null 2>&1; then
    firebase login --reauth
  fi
else
  echo "==> 1. Auth skipped (SKIP_AUTH=1)"
  gcloud config set project somo-callsomo 2>/dev/null || true
fi

echo "==> 2. Pull latest main"
git checkout main && git pull origin main

if [[ "$SKIP_TESTS" != "1" ]]; then
  echo "==> 3. Local CI gate (npm run ci:gate)"
  npm run ci:gate
else
  echo "==> 3. Local CI skipped (SKIP_TESTS=1)"
fi

echo "==> 4. Deploy API (Cloud Run + Kelly env verify)"
npm run callsomo:deploy-api

echo "==> 5. Deploy UI (Firebase hosting)"
npm run callsomo:deploy-ui

echo "==> 6. Post-deploy smoke"
npm run smoke:callsomo

echo "==> 7. Kelly Cloud Run env snapshot"
GCP_PROJECT=somo-callsomo npm run verify:kelly-rails-cloudrun --prefix middleware-platform

echo "==> 8. Voice routing matrix smoke"
npm run smoke:voice-routing-matrix --prefix middleware-platform

echo "==> 9. Optional live booking verify (after a real call)"
echo "    SESSION_ID=<call_id> DB_PATH=/path/to/prod.db npm run verify:live-booking-call --prefix middleware-platform"

echo "Done."
