#!/usr/bin/env bash
set -euo pipefail

# Push live Stripe keys to GCP Secret Manager (production bundle).
# Does NOT switch api.callsomo.com to live until production-profile deploy.
#
# Usage:
#   ./scripts/rotate-stripe-production.sh              # secrets + production deploy
#   ./scripts/rotate-stripe-production.sh --secrets-only

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
  local env_key="$1"
  local gcp_suffix="$2"
  local val secret
  val="$(grep -E "^${env_key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//')"
  if [[ -z "$val" ]]; then
    echo "WARN: $env_key not set in $ENV_FILE (skip)"
    return 0
  fi
  secret="somo-production-stripe-${gcp_suffix}"
  echo "Upsert $secret"
  if gcloud secrets describe "$secret" --project="$PROJECT" >/dev/null 2>&1; then
    echo -n "$val" | gcloud secrets versions add "$secret" --project="$PROJECT" --data-file=-
  else
    echo -n "$val" | gcloud secrets create "$secret" --project="$PROJECT" --data-file=- --replication-policy=automatic
  fi
}

echo "==> Verify live Stripe config (optional until sk_live added)"
set +e
npm run verify:stripe-keys --prefix "$ROOT/middleware-platform" -- --mode=live
set -e

echo "==> Push live Stripe secrets to GCP (project=$PROJECT)"
upsert_secret STRIPE_LIVE_SECRET_KEY secret-key
upsert_secret STRIPE_LIVE_PUBLISHABLE_KEY publishable-key
upsert_secret STRIPE_LIVE_WEBHOOK_SECRET webhook-secret

if [[ "$SECRETS_ONLY" == "1" ]]; then
  echo "==> Live secrets pushed. Test mode remains active on staging deploy."
  echo "    Cutover: USE_GCP_SECRETS=1 ./scripts/deploy-to-gcp-production.sh"
  exit 0
fi

echo "==> Deploy production profile (STRIPE_BILLING_MODE=live)"
ALLOW_SKIP_CI=1 USE_GCP_SECRETS=1 "$ROOT/scripts/deploy-to-gcp-production.sh"

echo "==> Post-deploy smoke"
npm run smoke:callsomo --prefix "$ROOT"

echo "Done. Live Stripe bundle deployed."
