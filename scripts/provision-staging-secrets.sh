#!/usr/bin/env bash
set -euo pipefail

# Seed GCP Secret Manager from local .env (staging only — operator one-time).
# Usage: ./scripts/provision-staging-secrets.sh

PROJECT="${GCP_PROJECT:-somo-callsomo}"
ENV_FILE="${1:-middleware-platform/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

KEYS=(
  JWT_SECRET ADMIN_PORTAL_SECRET API_KEY_ENCRYPTION_KEY
  RETELL_WEBHOOK_SECRET RETELL_WEBHOOK_TOKEN STRIPE_WEBHOOK_SECRET STRIPEWebhook
  STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY
  TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_VERIFY_SERVICE_SID
  SOMO_OWNER_PASSWORD POSTGRES_URL RETELL_API_KEY RETELL_AGENT_ID
)

for key in "${KEYS[@]}"; do
  val="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//' || true)"
  secret="somo-staging-$(echo "$key" | tr '[:upper:]' '[:lower:]' | tr '_' '-')"
  if [[ -z "$val" ]]; then
    case "$key" in
      JWT_SECRET|ADMIN_PORTAL_SECRET|API_KEY_ENCRYPTION_KEY)
        echo "Generate $secret (not in $ENV_FILE)"
        val="$(openssl rand -hex 32)"
        ;;
      *)
        continue
        ;;
    esac
  fi
  echo "Upsert secret $secret"
  echo -n "$val" | gcloud secrets create "$secret" --project="$PROJECT" --data-file=- --replication-policy=automatic 2>/dev/null \
    || echo -n "$val" | gcloud secrets versions add "$secret" --project="$PROJECT" --data-file=-
done

echo "Done. Deploy with USE_GCP_SECRETS=1 ./scripts/deploy-to-gcp.sh"
