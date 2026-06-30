#!/usr/bin/env bash
set -euo pipefail

# Deploy middleware to Cloud Run (default service: somo-middleware).
# Usage: ./scripts/deploy-to-gcp.sh
# Production: use ./scripts/deploy-to-gcp-production.sh (sets CLOUDRUN_PROFILE=production).
# Env: GCP_PROJECT, GCP_REGION, CLOUDRUN_SERVICE, CLOUDSQL_CONNECTION_NAME, CLOUDRUN_PROFILE

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MP="$ROOT/middleware-platform"
# shellcheck source=scripts/lib/cloudrun-deploy-env.sh
source "$ROOT/scripts/lib/cloudrun-deploy-env.sh"

PROJECT="${GCP_PROJECT:-$CLOUDRUN_GCP_PROJECT}"
REGION="${GCP_REGION:-$CLOUDRUN_REGION}"
SERVICE="${CLOUDRUN_SERVICE}"
IMAGE="${ARTIFACT_IMAGE:-gcr.io/${PROJECT}/${SERVICE}:$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)}"
ENV_FILE="${CLOUDRUN_ENV_FILE:-/tmp/cloudrun-env-$$.yaml}"
SECRETS_FILE="${CLOUDRUN_SECRETS_FILE:-/tmp/cloudrun-secrets-$$.txt}"
PROFILE="${CLOUDRUN_PROFILE:-staging}"

if [[ "${DEPLOY_INTENT:-}" == "production" && "$PROFILE" != "production" ]]; then
  echo "ERROR: DEPLOY_INTENT=production requires CLOUDRUN_PROFILE=production"
  echo "       Use: ./scripts/deploy-to-gcp-production.sh"
  exit 1
fi

if [[ "${REQUIRE_EXPLICIT_PROFILE:-}" == "1" && -z "${CLOUDRUN_PROFILE:-}" ]]; then
  echo "ERROR: Set CLOUDRUN_PROFILE=staging|production (default is staging)."
  exit 1
fi

echo "==> Deploy $SERVICE to Cloud Run"
echo "    project: $PROJECT"
echo "    region:  $REGION"
echo "    image:   $IMAGE"
echo "    profile: $PROFILE"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI not found. Install Google Cloud SDK."
  exit 1
fi

if [[ "${ALLOW_SKIP_CI:-}" != "1" ]]; then
  echo "==> Phase 0 CI gate (npm run ci:phase0)..."
  npm run ci:phase0 --prefix "$ROOT"
else
  echo "WARN: ALLOW_SKIP_CI=1 — skipping ci:phase0 before Cloud Build" >&2
fi

gcloud config set project "$PROJECT" >/dev/null

echo "==> Building container (Cloud Build)..."
gcloud builds submit "$MP" --tag "$IMAGE" --project "$PROJECT"

PRESERVE_ENV="${CLOUDRUN_PRESERVE_ENV:-}"
if [[ "$PROFILE" == "production" && -z "$PRESERVE_ENV" ]]; then
  PRESERVE_ENV=1
fi

DEPLOY_ARGS=(
  run deploy "$SERVICE"
  --image "$IMAGE"
  --region "$REGION"
  --platform managed
  --allow-unauthenticated
  --no-invoker-iam-check
  --min-instances "${CLOUDRUN_MIN_INSTANCES:-1}"
  --max-instances "${CLOUDRUN_MAX_INSTANCES:-1}"
  --concurrency "${CLOUDRUN_CONCURRENCY:-30}"
  --memory "${CLOUDRUN_MEMORY:-2Gi}"
  --cpu "${CLOUDRUN_CPU:-2}"
  --timeout "${CLOUDRUN_TIMEOUT:-300}"
  --ingress all
  --startup-probe "httpGet.path=/health/live,initialDelaySeconds=60,timeoutSeconds=10,periodSeconds=10,failureThreshold=60"
)

if [[ "$PRESERVE_ENV" == "1" ]]; then
  echo "==> Production image deploy (preserving existing service env vars)"
  # Re-apply Kelly Rails flags — staging --env-vars-file deploys can wipe them.
  PRESERVE_ENV_UPDATES="GCS_DB_BUCKET=${GCS_DB_BUCKET:-somo-staging-db-somo-callsomo},DB_PATH=${CLOUDRUN_DB_PATH:-/var/data/middleware-staging.db},KELLY_RAILS_V2=1,KELLY_ALLOW_HYBRID_GRAPH=0,KELLY_RAILS_ROLLOUT_PCT=1,USE_TRIAGE_RAG_V2=1,RAG_API_URL=disabled,VOICE_RATE_LIMIT_BACKEND=${VOICE_RATE_LIMIT_BACKEND:-redis}"
  if [[ -n "${PINECONE_INDEX_HOST:-}" ]]; then
    PRESERVE_ENV_UPDATES+=",PINECONE_INDEX_HOST=${PINECONE_INDEX_HOST}"
  fi
  DEPLOY_ARGS+=(
    --update-env-vars "$PRESERVE_ENV_UPDATES"
  )
else
  echo "==> Generating env vars file..."
  USE_GCP_SECRETS="${USE_GCP_SECRETS:-}" \
    CLOUDRUN_PROFILE="$PROFILE" \
    GCP_PROJECT="$PROJECT" \
    GCS_DB_BUCKET="${GCS_DB_BUCKET:-}" \
    CLOUDRUN_DB_PATH="${CLOUDRUN_DB_PATH:-/var/data/middleware-staging.db}" \
    CLOUDRUN_BASE_URL="${CLOUDRUN_BASE_URL:-}" \
    node "$MP/scripts/generate-cloudrun-env-yaml.cjs" "$ENV_FILE" "$SECRETS_FILE"
  DEPLOY_ARGS+=(--env-vars-file "$ENV_FILE")
  if [[ -f "$SECRETS_FILE" && -s "$SECRETS_FILE" ]]; then
    SET_SECRETS="$(tr -d '\n' < "$SECRETS_FILE")"
    echo "==> Binding Secret Manager refs (${SET_SECRETS//,/, }...)"
    DEPLOY_ARGS+=(--set-secrets="$SET_SECRETS")
  fi
fi

if [[ -n "${CLOUDSQL_CONNECTION_NAME:-}" ]]; then
  DEPLOY_ARGS+=(--add-cloudsql-instances "$CLOUDSQL_CONNECTION_NAME")
fi

if [[ -n "${GCS_DB_BUCKET:-}" ]]; then
  echo "    GCS_DB_BUCKET=$GCS_DB_BUCKET (set on service for cloudrun-db-sync)"
fi

gcloud "${DEPLOY_ARGS[@]}" --project "$PROJECT" --command="" --args=""

echo "==> Done. Verify:"
API_BASE="${CLOUDRUN_BASE_URL:-$CLOUDRUN_API_HOST}"
echo "    curl -sS ${API_BASE}/health/live"
echo "    curl -sS ${API_BASE}/health"
