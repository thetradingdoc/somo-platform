#!/usr/bin/env bash
# Audit Somo GCP billing + legacy Skin&Care conflicts. No destructive actions by default.
# Usage:
#   ./scripts/gcp-somo-billing-audit.sh              # audit only
#   ./scripts/gcp-somo-billing-audit.sh link         # link somo-callsomo billing
#   ./scripts/gcp-somo-billing-audit.sh cleanup      # remove confirmed legacy conflicts
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/cloudrun-deploy-env.sh
source "$ROOT/scripts/lib/cloudrun-deploy-env.sh"

export GCP_PROJECT="${GCP_PROJECT:-$CLOUDRUN_GCP_PROJECT}"
export GCP_REGION="${GCP_REGION:-$CLOUDRUN_REGION}"
export LEGACY_GCP_PROJECT="${LEGACY_GCP_PROJECT:-doctor-little-c688d}"
export BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-01C6D0-FF58E7-D0AF40}"
export FIREBASE_HOSTING_PROJECT="${FIREBASE_HOSTING_PROJECT:-somo-4ddf6}"

CMD="${1:-audit}"

gcloud config set account "${GCLOUD_ACCOUNT:-richard@callsomo.com}" >/dev/null
gcloud config set project "$GCP_PROJECT" >/dev/null

section() {
  echo ""
  echo "==> $1"
}

run_audit() {
  section "Billing: $GCP_PROJECT"
  gcloud billing projects describe "$GCP_PROJECT" 2>&1 || echo "(no billing link or access denied)"

  section "Billing accounts"
  gcloud billing accounts list --format='table(name,displayName,open)' 2>&1 || true

  section "GCP projects (skin/doclittle/somo)"
  gcloud projects list --format='table(projectId,name,lifecycleState)' 2>&1 \
    | grep -iE 'projectId|somo|skin|doclittle|doctor|myskin' || gcloud projects list --format='table(projectId,name,lifecycleState)'

  section "Cloud Run ingress ($GCP_PROJECT / somo-middleware)"
  gcloud run services describe somo-middleware --region="$GCP_REGION" --project="$GCP_PROJECT" \
    --format='value(metadata.annotations.run\.googleapis\.com/ingress)' 2>&1 || true
  gcloud run services list --region="$GCP_REGION" --project="$GCP_PROJECT" --format='table(name,status.url)' 2>&1 || true

  section "Domain mappings ($GCP_PROJECT)"
  gcloud beta run domain-mappings list --region="$GCP_REGION" --project="$GCP_PROJECT" 2>&1 || true
  gcloud beta run domain-mappings describe --domain=api.callsomo.com \
    --region="$GCP_REGION" --project="$GCP_PROJECT" \
    --format='yaml(spec.routeName,status.conditions)' 2>&1 || echo "(no api.callsomo.com on $GCP_PROJECT)"

  section "Domain mappings (legacy $LEGACY_GCP_PROJECT)"
  gcloud beta run domain-mappings describe --domain=api.callsomo.com \
    --region="$GCP_REGION" --project="$LEGACY_GCP_PROJECT" \
    --format='yaml(spec.routeName,status.conditions)' 2>&1 || echo "(no api.callsomo.com on $LEGACY_GCP_PROJECT)"

  section "GCS buckets ($GCP_PROJECT)"
  gsutil ls -p "$GCP_PROJECT" 2>&1 || true

  section "GCS buckets matching skinandcare (all accessible)"
  gsutil ls 2>/dev/null | grep -i skin || echo "(none found or no access)"

  section "Firebase projects"
  if command -v firebase >/dev/null 2>&1; then
    firebase projects:list 2>&1 || npx firebase-tools projects:list 2>&1 || true
  else
    npx firebase-tools projects:list 2>&1 || true
  fi

  section "HTTP probes"
  curl -sS -o /dev/null -w "callsomo.com: %{http_code}\n" https://callsomo.com/ || true
  curl -sS -o /dev/null -w "api.callsomo.com/health/live: %{http_code}\n" https://api.callsomo.com/health/live || true
}

link_billing() {
  section "Link $GCP_PROJECT -> billing account $BILLING_ACCOUNT_ID"
  gcloud billing projects link "$GCP_PROJECT" --billing-account="$BILLING_ACCOUNT_ID"
  gcloud billing projects describe "$GCP_PROJECT"
}

run_cleanup() {
  section "Legacy cleanup (confirmed conflicts only)"

  if gcloud beta run domain-mappings describe --domain=api.callsomo.com \
    --region="$GCP_REGION" --project="$LEGACY_GCP_PROJECT" >/dev/null 2>&1; then
    echo "Deleting api.callsomo.com mapping from $LEGACY_GCP_PROJECT..."
    gcloud beta run domain-mappings delete --domain=api.callsomo.com \
      --region="$GCP_REGION" --project="$LEGACY_GCP_PROJECT" --quiet
  else
    echo "No api.callsomo.com mapping on $LEGACY_GCP_PROJECT"
  fi

  if gcloud run services describe myskin-middleware \
    --region="$GCP_REGION" --project="$GCP_PROJECT" >/dev/null 2>&1; then
    echo "Deleting myskin-middleware from $GCP_PROJECT..."
    gcloud run services delete myskin-middleware \
      --region="$GCP_REGION" --project="$GCP_PROJECT" --quiet
  else
    echo "No myskin-middleware service on $GCP_PROJECT"
  fi

  "$ROOT/scripts/ensure-cloudrun-public-invoker.sh" || true

  section "Ensure public ingress on somo-middleware"
  gcloud run services update somo-middleware \
    --region="$GCP_REGION" --project="$GCP_PROJECT" \
    --ingress=all
}

case "$CMD" in
  audit) run_audit ;;
  link) link_billing ;;
  cleanup) run_cleanup ;;
  all)
    run_audit
    link_billing
    sleep 30
    run_cleanup
    ;;
  *)
    echo "Usage: $0 [audit|link|cleanup|all]"
    exit 1
    ;;
esac

echo ""
echo "Done ($CMD)."
