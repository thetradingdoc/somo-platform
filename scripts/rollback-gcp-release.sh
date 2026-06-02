#!/usr/bin/env bash
set -euo pipefail

# Roll back Cloud Run to previous revision.
# Usage: ./scripts/rollback-gcp-release.sh

PROJECT="${GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-somo-callsomo}}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${CLOUDRUN_SERVICE:-myskin-middleware}"

echo "==> List recent revisions for $SERVICE"
gcloud run revisions list --service "$SERVICE" --region "$REGION" --project "$PROJECT" --limit 5

PREV="$(gcloud run revisions list --service "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format='value(name)' --limit 2 | tail -1)"

if [[ -z "$PREV" ]]; then
  echo "ERROR: No previous revision found."
  exit 1
fi

echo "==> Routing 100% traffic to $PREV"
gcloud run services update-traffic "$SERVICE" \
  --to-revisions="${PREV}=100" \
  --region "$REGION" \
  --project "$PROJECT"

echo "==> Post-rollback smoke"
UI_BASE_URL="${UI_BASE_URL:-https://callsomo.com}" \
MIDDLEWARE_API_BASE="${MIDDLEWARE_API_BASE:-https://api.callsomo.com}" \
  npm run verify:prod:routing-smoke --prefix middleware-platform

echo "==> Rollback complete."
