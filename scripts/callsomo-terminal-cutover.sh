#!/usr/bin/env bash
# Terminal cutover helper for callsomo.com (somo-callsomo).
# Usage: ./scripts/callsomo-terminal-cutover.sh [check|fix-api-public|deploy-api|deploy-ui|smoke|e2e-smoke|e2e-full]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export GCP_PROJECT="${GCP_PROJECT:-somo-callsomo}"
export GCP_REGION="${GCP_REGION:-us-central1}"
export CLOUDRUN_SERVICE="${CLOUDRUN_SERVICE:-myskin-middleware}"
export UI_BASE_URL="${UI_BASE_URL:-https://callsomo.com}"
export MIDDLEWARE_API_BASE="${MIDDLEWARE_API_BASE:-https://api.callsomo.com}"
export GCS_DB_BUCKET="${GCS_DB_BUCKET:-somo-staging-db-${GCP_PROJECT}}"
export FIREBASE_HOSTING_PROJECT="${FIREBASE_HOSTING_PROJECT:-somo-4ddf6}"

gcloud config set account "${GCLOUD_ACCOUNT:-richard@callsomo.com}" >/dev/null
gcloud config set project "$GCP_PROJECT" >/dev/null

run_url() {
  gcloud run services describe "$CLOUDRUN_SERVICE" --region="$GCP_REGION" --project="$GCP_PROJECT" --format='value(status.url)'
}

cmd="${1:-check}"

case "$cmd" in
  check)
    echo "==> DNS"
    dig +short callsomo.com A | head -3 || true
    dig +short api.callsomo.com CNAME || echo "(api.callsomo.com missing — add CNAME api -> ghs.googlehosted.com)"
    echo ""
    echo "==> HTTP"
    curl -sS -o /dev/null -w "callsomo.com: %{http_code}\n" "$UI_BASE_URL/" || true
    curl -sS -o /dev/null -w "api.callsomo.com/health/live: %{http_code}\n" "$MIDDLEWARE_API_BASE/health/live" || true
    RUN="$(run_url)"
    TOKEN="$(gcloud auth print-identity-token)"
    curl -sS -o /dev/null -w "cloud_run (auth): %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$RUN/health/live"
    curl -sS -o /dev/null -w "cloud_run (public): %{http_code}\n" "$RUN/health/live"
    echo ""
    echo "==> Manual (not terminal-only):"
    echo "  1. Registrar: point callsomo.com to Firebase (currently may be Squarespace)"
    echo "  2. Registrar: api CNAME -> ghs.googlehosted.com"
    echo "  3. Firebase Console: link $GCP_PROJECT, add custom domain callsomo.com"
    echo "  4. If api 403: ./scripts/ensure-cloudrun-public-invoker.sh"
    ;;
  fix-api-public)
    "$ROOT/scripts/ensure-cloudrun-public-invoker.sh"
    ;;
  deploy-api)
    export USE_GCP_SECRETS=1 CLOUDRUN_PROFILE=staging CLOUDRUN_BASE_URL="$MIDDLEWARE_API_BASE"
    "$ROOT/scripts/deploy-to-gcp.sh"
    ;;
  deploy-ui)
    VITE_API_BASE="$MIDDLEWARE_API_BASE" npm run build:staging-hosting --prefix "$ROOT"
    (cd "$ROOT/unified-dashboard" && npx firebase-tools deploy --only hosting --project "$FIREBASE_HOSTING_PROJECT")
    ;;
  smoke)
    UI_BASE_URL="$UI_BASE_URL" MIDDLEWARE_API_BASE="$MIDDLEWARE_API_BASE" npm run smoke:callsomo --prefix "$ROOT"
    ;;
  e2e-smoke)
    export PW_API_BASE_URL="${PW_API_BASE_URL:-$(run_url)}"
    export PLAYWRIGHT_API_BEARER="${PLAYWRIGHT_API_BEARER:-$(gcloud auth print-identity-token)}"
    npm run test:e2e:callsomo:smoke --prefix "$ROOT/middleware-platform"
    ;;
  e2e-full)
    export PW_API_BASE_URL="${PW_API_BASE_URL:-$(run_url)}"
    export PLAYWRIGHT_API_BEARER="${PLAYWRIGHT_API_BEARER:-$(gcloud auth print-identity-token)}"
    npm run test:e2e:callsomo --prefix "$ROOT/middleware-platform"
    ;;
  *)
    echo "Usage: $0 {check|deploy-api|deploy-ui|smoke|e2e-smoke|e2e-full}"
    exit 1
    ;;
esac
