#!/usr/bin/env bash
# Local production deploy: Cloud Run API + Firebase Hosting (no GitHub Actions).
# Usage: ./scripts/deploy-callsomo-local.sh [--skip-ci] [--skip-api] [--skip-ui] [--skip-smoke]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/lib/cloudrun-deploy-env.sh
source "$ROOT/scripts/lib/cloudrun-deploy-env.sh"

export GCP_PROJECT="${GCP_PROJECT:-$CLOUDRUN_GCP_PROJECT}"
export GCP_REGION="${GCP_REGION:-$CLOUDRUN_REGION}"
export CLOUDRUN_SERVICE="${CLOUDRUN_SERVICE:-$CLOUDRUN_SERVICE}"
export MIDDLEWARE_API_BASE="${MIDDLEWARE_API_BASE:-$CLOUDRUN_API_HOST}"
export FIREBASE_HOSTING_PROJECT="${FIREBASE_HOSTING_PROJECT:-somo-4ddf6}"

SKIP_CI=0
SKIP_API=0
SKIP_UI=0
SKIP_SMOKE=0
for arg in "$@"; do
  case "$arg" in
    --skip-ci) SKIP_CI=1 ;;
    --skip-api) SKIP_API=1 ;;
    --skip-ui) SKIP_UI=1 ;;
    --skip-smoke) SKIP_SMOKE=1 ;;
  esac
done

ensure_api_domain_mapping() {
  echo "==> Cloud Run domain mapping (api.callsomo.com)"
  gcloud beta run domain-mappings create \
    --service="$CLOUDRUN_SERVICE" \
    --domain=api.callsomo.com \
    --region="$GCP_REGION" \
    --project="$GCP_PROJECT" 2>/dev/null || true
  gcloud beta run domain-mappings describe \
    --domain=api.callsomo.com \
    --region="$GCP_REGION" \
    --project="$GCP_PROJECT" \
    --format='yaml(status.resourceRecords,status.conditions)' || true
}

if [[ "$SKIP_CI" -eq 0 ]]; then
  echo "==> Build and verify hosting bundle..."
  node scripts/build-staging-hosting.cjs
  node scripts/verify-staging-hosting.cjs
fi

if [[ "$SKIP_API" -eq 0 ]]; then
  echo "==> Deploy API to Cloud Run (production profile)..."
  gcloud config set project "$GCP_PROJECT" >/dev/null
  export USE_GCP_SECRETS=1
  export DEPLOY_INTENT=production
  export CLOUDRUN_PROFILE=production
  export CLOUDRUN_BASE_URL="$MIDDLEWARE_API_BASE"
  export CLOUDRUN_PRESERVE_ENV="${CLOUDRUN_PRESERVE_ENV:-0}"
  "$ROOT/scripts/deploy-to-gcp-production.sh"
  ensure_api_domain_mapping
  "$ROOT/scripts/ensure-cloudrun-public-invoker.sh"

  if [[ -n "${RETELL_API_KEY:-}" ]]; then
    echo "==> Configure Retell agent..."
    (cd "$ROOT/middleware-platform" && API_BASE_URL="$MIDDLEWARE_API_BASE" node configure-retell.js)
  else
    echo "==> RETELL_API_KEY not set — skip configure-retell.js"
  fi
fi

if [[ "$SKIP_UI" -eq 0 ]]; then
  echo "==> Deploy UI to Firebase ($FIREBASE_HOSTING_PROJECT)..."
  VITE_API_BASE="$MIDDLEWARE_API_BASE" npm run build:staging-hosting --prefix "$ROOT"
  (cd "$ROOT/unified-dashboard" && npx firebase-tools deploy --only hosting --project "$FIREBASE_HOSTING_PROJECT")
fi

if [[ "$SKIP_SMOKE" -eq 0 ]]; then
  echo "==> Post-deploy smoke..."
  npm run smoke:callsomo
fi

echo "==> Local callsomo deploy complete."
