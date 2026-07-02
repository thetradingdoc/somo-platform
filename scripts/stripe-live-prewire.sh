#!/usr/bin/env bash
set -euo pipefail

# Pre-wire live Stripe (prices + webhook + GCP secrets). Requires STRIPE_LIVE_SECRET_KEY in .env.
# Run from repo root: npm run stripe:live-prewire

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/middleware-platform/.env"
MP="$ROOT/middleware-platform"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing $ENV_FILE"
  exit 1
fi

if ! grep -qE '^STRIPE_LIVE_SECRET_KEY=sk_live_' "$ENV_FILE"; then
  echo "ERROR: Add your live secret key to middleware-platform/.env first:"
  echo "  STRIPE_LIVE_SECRET_KEY=sk_live_..."
  echo "Get it from: https://dashboard.stripe.com/apikeys (toggle Test mode OFF)"
  exit 1
fi

echo "==> Live prices"
npm run billing:setup-stripe-live-prices --prefix "$MP" -- --write-env

echo "==> Live webhook"
npm run billing:setup-stripe-webhook --prefix "$MP" -- --write-env --live

echo "==> Push secrets to GCP"
"$ROOT/scripts/rotate-stripe-production.sh" --secrets-only

echo "==> Verify both bundles"
npm run verify:stripe-keys:both --prefix "$MP"

echo "Done. Test mode still active on api.callsomo.com until production deploy."
