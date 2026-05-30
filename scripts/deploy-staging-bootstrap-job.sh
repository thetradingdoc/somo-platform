#!/usr/bin/env bash
set -euo pipefail

PROJECT="${GCP_PROJECT:-doctor-little-c688d}"
REGION="${GCP_REGION:-us-central1}"
JOB="${STAGING_BOOTSTRAP_JOB:-somo-staging-bootstrap}"
SERVICE="${CLOUDRUN_SERVICE:-myskin-middleware}"
IMAGE="${ARTIFACT_IMAGE:-gcr.io/${PROJECT}/${SERVICE}:$(git -C "$(dirname "$0")/.." rev-parse --short HEAD 2>/dev/null || echo latest)}"
CONNECTION="${CLOUDSQL_CONNECTION_NAME:-${PROJECT}:${REGION}:somo-staging-pg}"
TWILIO_PHONE="${STAGING_OWNER_TWILIO_PHONE:-+13639990205}"
TWILIO_SID="${STAGING_OWNER_TWILIO_SID:-PNa74666cb828d4fa385df5d74292fd18e}"

echo "==> Deploy Cloud Run Job: $JOB"

gcloud run jobs deploy "$JOB" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --set-cloudsql-instances="$CONNECTION" \
  --memory=2Gi \
  --cpu=2 \
  --task-timeout=900 \
  --set-env-vars="CLOUDRUN_PROFILE=staging,STAGING=1,ALLOW_STRIPE_TEST_IN_PRODUCTION=1,PUBLIC_BASE_URL=https://api.myskinandcare.com,API_BASE_URL=https://api.myskinandcare.com,SOMO_OWNER_EMAIL=drlittlekids@gmail.com,SOMO_OWNER_CLINIC_PHONE=${TWILIO_PHONE},SOMO_OWNER_NAME=Somo Owner,SOMO_OWNER_CLINIC_NAME=Somo Clinic,STAGING_OWNER_TWILIO_PHONE=${TWILIO_PHONE},STAGING_OWNER_TWILIO_SID=${TWILIO_SID},GCS_DB_BUCKET=somo-staging-db,DB_PATH=/var/data/middleware-staging.db,SKIP_STARTUP_MIGRATIONS=0" \
  --set-secrets="SOMO_OWNER_PASSWORD=somo-staging-somo-owner-password:latest,RETELL_API_KEY=somo-staging-retell-api-key:latest,TWILIO_ACCOUNT_SID=somo-staging-twilio-account-sid:latest,TWILIO_AUTH_TOKEN=somo-staging-twilio-auth-token:latest" \
  --command="node" \
  --args="scripts/run-staging-bootstrap.cjs" \
  --tasks=1 \
  --max-retries=0

echo "==> Execute job once"
gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" --wait

echo "==> Bootstrap job finished."
