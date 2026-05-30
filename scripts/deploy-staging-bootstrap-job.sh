#!/usr/bin/env bash
set -euo pipefail

# Create/update Cloud Run Job somo-staging-bootstrap (owner + Twilio + Retell).
# Requires: gcloud, deployed myskin-middleware image, secrets in Secret Manager.

PROJECT="${GCP_PROJECT:-doctor-little-c688d}"
REGION="${GCP_REGION:-us-central1}"
JOB="${STAGING_BOOTSTRAP_JOB:-somo-staging-bootstrap}"
SERVICE="${CLOUDRUN_SERVICE:-myskin-middleware}"
IMAGE="${ARTIFACT_IMAGE:-gcr.io/${PROJECT}/${SERVICE}:latest}"
CONNECTION="${CLOUDSQL_CONNECTION_NAME:-${PROJECT}:${REGION}:somo-staging-pg}"

echo "==> Deploy Cloud Run Job: $JOB"

gcloud run jobs deploy "$JOB" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --set-cloudsql-instances="$CONNECTION" \
  --set-env-vars="CLOUDRUN_PROFILE=staging,USE_GCP_SECRETS=1,PUBLIC_BASE_URL=https://api.myskinandcare.com,API_BASE_URL=https://api.myskinandcare.com" \
  --command="node" \
  --args="scripts/run-staging-bootstrap.cjs" \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=600

echo "==> Execute job once"
gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" --wait

echo "==> Bootstrap job finished."
