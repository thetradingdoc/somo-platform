#!/usr/bin/env bash
# Bootstrap GCP project somo-callsomo (callsomo.com cutover).
# Requires: gcloud auth as richard@callsomo.com, open billing on org.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export GCP_PROJECT="${GCP_PROJECT:-somo-callsomo}"
export GCP_REGION="${GCP_REGION:-us-central1}"
export BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-01C6D0-FF58E7-D0AF40}"
export ORG_ID="${ORG_ID:-246054314357}"
export GCS_DB_BUCKET="${GCS_DB_BUCKET:-somo-staging-db-${GCP_PROJECT}}"

gcloud config set account "${GCLOUD_ACCOUNT:-richard@callsomo.com}"
gcloud config set project "$GCP_PROJECT"

if ! gcloud projects describe "$GCP_PROJECT" &>/dev/null; then
  echo "==> Create project $GCP_PROJECT"
  gcloud projects create "$GCP_PROJECT" --name="Somo" --organization="$ORG_ID"
  gcloud billing projects link "$GCP_PROJECT" --billing-account="$BILLING_ACCOUNT_ID"
fi

echo "==> Enable APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com \
  storage.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  firebase.googleapis.com firebasehosting.googleapis.com --project="$GCP_PROJECT"

echo "==> Provision secrets"
GCP_PROJECT="$GCP_PROJECT" "$ROOT/scripts/provision-staging-secrets.sh"

echo "==> GCS bucket"
gsutil mb -p "$GCP_PROJECT" -l "$GCP_REGION" "gs://${GCS_DB_BUCKET}" 2>/dev/null || true

echo "==> Deploy API"
export USE_GCP_SECRETS=1 CLOUDRUN_BASE_URL=https://api.callsomo.com CLOUDRUN_PROFILE=staging
"$ROOT/scripts/deploy-to-gcp.sh"

echo "==> Domain mapping (add DNS: api CNAME ghs.googlehosted.com)"
gcloud beta run domain-mappings create --service=somo-middleware \
  --domain=api.callsomo.com --region="$GCP_REGION" --project="$GCP_PROJECT" 2>/dev/null || true

echo "==> Firebase (manual if addFirebase 403): console.firebase.google.com → add $GCP_PROJECT"
echo "    Then: npm run build:staging-hosting && cd unified-dashboard && npx firebase deploy --only hosting --project $GCP_PROJECT"
