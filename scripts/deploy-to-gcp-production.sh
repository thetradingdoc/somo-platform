#!/usr/bin/env bash
set -euo pipefail

# Production deploy for api.callsomo.com (Cloud Run somo-middleware).
# Usage: ./scripts/deploy-to-gcp-production.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/cloudrun-deploy-env.sh
source "$ROOT/scripts/lib/cloudrun-deploy-env.sh"

export DEPLOY_INTENT=production
export CLOUDRUN_PROFILE=production
export REQUIRE_EXPLICIT_PROFILE=1
# Deploy to the service that currently owns api.callsomo.com when unset.
if [[ -z "${CLOUDRUN_SERVICE_SET:-}" ]]; then
  API_HOST="${CLOUDRUN_API_HOST#https://}"
  API_HOST="${API_HOST#http://}"
  API_HOST="${API_HOST%%/*}"
  MAPPED="$(gcloud beta run domain-mappings describe --domain "$API_HOST" --region "${CLOUDRUN_REGION:-us-central1}" --project "${CLOUDRUN_GCP_PROJECT:-somo-callsomo}" --format='value(spec.routeName)' 2>/dev/null || true)"
  if [[ -n "$MAPPED" ]]; then
    export CLOUDRUN_SERVICE="$MAPPED"
    echo "==> Domain $API_HOST maps to Cloud Run service: $CLOUDRUN_SERVICE"
  fi
fi

exec "$(dirname "$0")/deploy-to-gcp.sh" "$@"
