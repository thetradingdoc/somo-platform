#!/usr/bin/env bash
# Ship customer-ready P0–P2 to production (run after merge to main).
# Requires: gcloud auth login, firebase login --reauth
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 1. Auth (if needed)"
gcloud auth login
gcloud config set project somo-callsomo
firebase login --reauth

echo "==> 2. Pull latest main"
git checkout main && git pull origin main

echo "==> 3. Pre-deploy tests"
cd middleware-platform
npm test -- --testPathPattern="booking-confirm|saas-tenant-provision|kelly-rails-tool-allowlists|kelly-activity-feed"
npm run test:e2e:provider-journey
cd "$ROOT"

echo "==> 4. Deploy API (Cloud Run + Kelly env verify)"
npm run callsomo:deploy-api

echo "==> 5. Deploy UI (Firebase hosting)"
npm run callsomo:deploy-ui

echo "==> 6. Post-deploy smoke"
npm run smoke:callsomo

echo "==> 7. Kelly Cloud Run env snapshot"
GCP_PROJECT=somo-callsomo npm run verify:kelly-rails-cloudrun --prefix middleware-platform

echo "==> 8. Optional live booking verify (after a real call)"
echo "    SESSION_ID=<call_id> DB_PATH=/path/to/prod.db npm run verify:live-booking-call --prefix middleware-platform"

echo "Done."
