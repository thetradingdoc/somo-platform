#!/usr/bin/env bash
# Terminal cutover helper for callsomo.com (somo-callsomo).
# Usage: ./scripts/callsomo-terminal-cutover.sh [check|fix-api-public|deploy-api|deploy-ui|smoke|e2e-smoke|e2e-full]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/cloudrun-deploy-env.sh
source "$ROOT/scripts/lib/cloudrun-deploy-env.sh"

export GCP_PROJECT="${GCP_PROJECT:-$CLOUDRUN_GCP_PROJECT}"
export GCP_REGION="${GCP_REGION:-$CLOUDRUN_REGION}"
export CLOUDRUN_SERVICE="${CLOUDRUN_SERVICE:-$CLOUDRUN_SERVICE}"
export UI_BASE_URL="${UI_BASE_URL:-https://callsomo.com}"
export MIDDLEWARE_API_BASE="${MIDDLEWARE_API_BASE:-$CLOUDRUN_API_HOST}"
export GCS_DB_BUCKET="${GCS_DB_BUCKET:-somo-staging-db-${GCP_PROJECT}}"
export FIREBASE_HOSTING_PROJECT="${FIREBASE_HOSTING_PROJECT:-somo-4ddf6}"

gcloud config set account "${GCLOUD_ACCOUNT:-richard@callsomo.com}" >/dev/null
gcloud config set project "$GCP_PROJECT" >/dev/null

run_url() {
  gcloud run services describe "$CLOUDRUN_SERVICE" --region="$GCP_REGION" --project="$GCP_PROJECT" --format='value(status.url)'
}

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

cmd="${1:-check}"

case "$cmd" in
  check)
    echo "==> DNS"
    dig +short callsomo.com A | head -3 || true
    dig +short api.callsomo.com CNAME || echo "(api.callsomo.com CNAME not visible yet)"
    echo ""
    echo "==> Cloud Run domain mapping"
    gcloud beta run domain-mappings describe \
      --domain=api.callsomo.com \
      --region="$GCP_REGION" \
      --project="$GCP_PROJECT" \
      --format='value(status.conditions.status)' 2>/dev/null || echo "(no mapping — run: $0 fix-api-domain)"
    echo ""
    echo "==> HTTP"
    curl -sS -o /dev/null -w "callsomo.com: %{http_code}\n" "$UI_BASE_URL/" || true
    curl -sS -o /dev/null -w "api.callsomo.com/health/live: %{http_code}\n" "$MIDDLEWARE_API_BASE/health/live" || true
    RUN="$(run_url)"
    TOKEN="$(gcloud auth print-identity-token)"
    curl -sS -o /dev/null -w "cloud_run (auth): %{http_code}\n" -H "Authorization: Bearer $TOKEN" "$RUN/health/live"
    curl -sS -o /dev/null -w "cloud_run (public): %{http_code}\n" "$RUN/health/live"
    echo ""
    echo "==> Operator checklist (order matters for API):"
    echo "  1. Deploy API: npm run callsomo:deploy-api  (or npm run deploy:callsomo)"
    echo "  2. Cloud Run domain mapping: $0 fix-api-domain"
    echo "  3. Registrar DNS: CNAME api.callsomo.com -> ghs.googlehosted.com (after step 2)"
    echo "  4. Public invoker if 403: $0 fix-api-public"
    echo "  5. Firebase UI: $0 deploy-ui (callsomo.com A records -> Firebase)"
    echo "  6. Retell: cd middleware-platform && API_BASE_URL=$MIDDLEWARE_API_BASE node configure-retell.js"
    ;;
  fix-api-domain)
    ensure_api_domain_mapping
    ;;
  fix-api-public)
    "$ROOT/scripts/ensure-cloudrun-public-invoker.sh"
    ;;
  deploy-api)
    export USE_GCP_SECRETS=1
    export CLOUDRUN_PROFILE=production
    export DEPLOY_INTENT=production
    export CLOUDRUN_BASE_URL="$MIDDLEWARE_API_BASE"
    export CLOUDRUN_PRESERVE_ENV="${CLOUDRUN_PRESERVE_ENV:-1}"
    "$ROOT/scripts/deploy-to-gcp-production.sh"
    ensure_api_domain_mapping
    "$ROOT/scripts/ensure-cloudrun-public-invoker.sh"
    echo "Verifying Kelly Rails Cloud Run env (KELLY_RAILS_V2, CONVERSATION_MODE_ROUTING)..."
    npm run verify:kelly-rails-cloudrun --prefix "$ROOT/middleware-platform" || {
      echo "ERROR: Kelly Rails env verification failed — fix Cloud Run env before accepting deploy."
      exit 1
    }
    if [[ "${SKIP_LIVE_CALL_VERIFY:-}" == "1" ]]; then
      echo "SKIP_LIVE_CALL_VERIFY=1 — skipping verify:live-booking-call"
    elif [[ -n "${SESSION_ID:-}${CALL_ID:-}" && -n "${DB_PATH:-}" ]]; then
      echo "Verifying live booking call telemetry (SESSION_ID=${SESSION_ID:-$CALL_ID})..."
      SESSION_ID="${SESSION_ID:-$CALL_ID}" DB_PATH="$DB_PATH" \
        npm run verify:live-booking-call --prefix "$ROOT/middleware-platform" || {
        echo "ERROR: Live booking call verification failed."
        exit 1
      }
    else
      echo "NOTE: Set SESSION_ID=<call_id> and DB_PATH=<sqlite> to run verify:live-booking-call after deploy (or SKIP_LIVE_CALL_VERIFY=1)."
    fi
    ;;
  deploy-ui)
    VITE_API_BASE="$MIDDLEWARE_API_BASE" npm run build:staging-hosting --prefix "$ROOT"
    (cd "$ROOT/unified-dashboard" && npx firebase-tools deploy --only "hosting:${FIREBASE_HOSTING_PROJECT}" --project "$FIREBASE_HOSTING_PROJECT")
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
    echo "Usage: $0 {check|fix-api-domain|fix-api-public|deploy-api|deploy-ui|smoke|e2e-smoke|e2e-full}"
    exit 1
    ;;
esac
