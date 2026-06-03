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
  --concurrency "${CLOUDRUN_CONCURRENCY:-30}"
  --memory "${CLOUDRUN_MEMORY:-2Gi}"
  --cpu "${CLOUDRUN_CPU:-2}"
  --timeout "${CLOUDRUN_TIMEOUT:-300}"
  --startup-probe "httpGet.path=/health/live,initialDelaySeconds=60,timeoutSeconds=10,periodSeconds=10,failureThreshold=60"
)

if [[ "$PRESERVE_ENV" == "1" ]]; then
  echo "==> Production image deploy (preserving existing service env vars)"
  DEPLOY_ARGS+=(
    --update-env-vars "GCS_DB_BUCKET=${GCS_DB_BUCKET:-somo-staging-db-somo-callsomo},DB_PATH=${CLOUDRUN_DB_PATH:-/var/data/middleware-staging.db}"
  )
else
  echo "==> Generating env vars file..."
  CLOUDRUN_PROFILE="$PROFILE" \
    GCS_DB_BUCKET="${GCS_DB_BUCKET:-}" \
    CLOUDRUN_DB_PATH="${CLOUDRUN_DB_PATH:-/var/data/middleware-staging.db}" \
    node "$MP/scripts/generate-cloudrun-env-yaml.cjs" "$ENV_FILE"
  DEPLOY_ARGS+=(--env-vars-file "$ENV_FILE")
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
echo "    curl -sS ${API_BASE}/api/public/somo-demo/health"
