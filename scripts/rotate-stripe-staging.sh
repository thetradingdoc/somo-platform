#!/usr/bin/env bash
set -euo pipefail

# Rotate Stripe keys on staging after updating middleware-platform/.env locally.
# Prereq: gcloud auth login (interactive) && npm run verify:stripe-keys
#
# Usage:
#   ./scripts/rotate-stripe-staging.sh              # secrets + deploy
#   ./scripts/rotate-stripe-staging.sh --secrets-only

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT/middleware-platform/.env}"
PROJECT="${GCP_PROJECT:-somo-callsomo}"
SECRETS_ONLY=0

if [[ "${1:-}" == "--secrets-only" ]]; then
  SECRETS_ONLY=1
  shift
  ENV_FILE="${1:-$ROOT/middleware-platform/.env}"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

upsert_secret() {
  local key="$1"
  local val secret
  val="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//')"
  if [[ -z "$val" ]]; then
    echo "ERROR: $key not set in $ENV_FILE"
    exit 1
  fi
  secret="somo-staging-$(echo "$key" | tr '[:upper:]' '[:lower:]' | tr '_' '-')"
  echo "Upsert $secret"
  if gcloud secrets describe "$secret" --project="$PROJECT" >/dev/null 2>&1; then
    echo -n "$val" | gcloud secrets versions add "$secret" --project="$PROJECT" --data-file=-
  else
    echo -n "$val" | gcloud secrets create "$secret" --project="$PROJECT" --data-file=- --replication-policy=automatic
  fi
}

echo "==> Local Stripe verification"
npm run verify:stripe-keys --prefix "$ROOT/middleware-platform"

echo "==> Push Stripe secrets to GCP Secret Manager (project=$PROJECT)"
for key in STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET; do
  upsert_secret "$key"
done

if [[ "$SECRETS_ONLY" == "1" ]]; then
  echo "==> Secrets only (--secrets-only). Redeploy when ready:"
  echo "    ALLOW_SKIP_CI=1 USE_GCP_SECRETS=1 CLOUDRUN_PROFILE=staging ./scripts/deploy-to-gcp.sh"
  exit 0
fi

echo "==> Deploy staging (STRIPE_PRICE_* from .env via generate-cloudrun-env-yaml)"
ALLOW_SKIP_CI=1 USE_GCP_SECRETS=1 CLOUDRUN_PROFILE=staging "$ROOT/scripts/deploy-to-gcp.sh"

echo "==> Post-deploy smoke"
npm run smoke:callsomo --prefix "$ROOT"

echo "Done. Stripe secrets rotated for staging."
