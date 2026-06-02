#!/usr/bin/env bash
set -euo pipefail

# Deploy middleware to Cloud Run (myskin-middleware).
# Usage: ./scripts/deploy-to-gcp.sh
# Env: GCP_PROJECT, GCP_REGION (default us-central1), CLOUDSQL_CONNECTION_NAME (optional)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MP="$ROOT/middleware-platform"

PROJECT="${GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-somo-callsomo}}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${CLOUDRUN_SERVICE:-myskin-middleware}"
IMAGE="${ARTIFACT_IMAGE:-gcr.io/${PROJECT}/${SERVICE}:$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)}"
ENV_FILE="${CLOUDRUN_ENV_FILE:-/tmp/cloudrun-env-$$.yaml}"
PROFILE="${CLOUDRUN_PROFILE:-staging}"

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

echo "==> Generating env vars file..."
CLOUDRUN_PROFILE="$PROFILE" node "$MP/scripts/generate-cloudrun-env-yaml.cjs" "$ENV_FILE"

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
  --env-vars-file "$ENV_FILE"
  --startup-probe "httpGet.path=/health/live,initialDelaySeconds=60,timeoutSeconds=10,periodSeconds=10,failureThreshold=60"
)

if [[ -n "${CLOUDSQL_CONNECTION_NAME:-}" ]]; then
  DEPLOY_ARGS+=(--add-cloudsql-instances "$CLOUDSQL_CONNECTION_NAME")
fi

if [[ -n "${GCS_DB_BUCKET:-}" ]]; then
  echo "    GCS_DB_BUCKET=$GCS_DB_BUCKET (set on service for cloudrun-db-sync)"
fi

gcloud "${DEPLOY_ARGS[@]}" --project "$PROJECT" --command="" --args=""

echo "==> Done. Verify:"
echo "    curl -sS ${CLOUDRUN_BASE_URL:-https://api.callsomo.com}/health/live"
