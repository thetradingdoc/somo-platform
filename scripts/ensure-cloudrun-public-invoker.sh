#!/usr/bin/env bash
# Ensure Cloud Run allows public invoke (Twilio/Retell webhooks).
# When org policy blocks allUsers IAM binding, use --no-invoker-iam-check instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/cloudrun-deploy-env.sh
source "$ROOT/scripts/lib/cloudrun-deploy-env.sh"

PROJECT="${GCP_PROJECT:-$CLOUDRUN_GCP_PROJECT}"
REGION="${GCP_REGION:-$CLOUDRUN_REGION}"
SERVICE="${CLOUDRUN_SERVICE:-$CLOUDRUN_SERVICE}"
API_BASE="${MIDDLEWARE_API_BASE:-$CLOUDRUN_API_HOST}"

echo "==> Project: $PROJECT  Service: $SERVICE  Region: $REGION"

if gcloud run services add-iam-policy-binding "$SERVICE" \
  --region="$REGION" --project="$PROJECT" \
  --member="allUsers" --role="roles/run.invoker" 2>/dev/null; then
  echo "==> Granted allUsers roles/run.invoker"
else
  echo "==> allUsers binding blocked (org policy). Applying --no-invoker-iam-check..."
  gcloud run services update "$SERVICE" \
    --region="$REGION" --project="$PROJECT" \
    --no-invoker-iam-check
fi

echo "==> Ensure public ingress (required for api.callsomo.com + Twilio/Retell)"
gcloud run services update "$SERVICE" \
  --region="$REGION" --project="$PROJECT" \
  --ingress=all

echo "==> Verify public health"
code=$(curl -sS -o /dev/null -w "%{http_code}" "$API_BASE/health/live" || echo "000")
echo "    $API_BASE/health/live → $code"
if [[ "$code" != "200" ]]; then
  echo "ERROR: Public API not reachable. See docs/runbooks/CALLSOMO_GCP_CUTOVER.md §3"
  exit 1
fi
echo "OK"
