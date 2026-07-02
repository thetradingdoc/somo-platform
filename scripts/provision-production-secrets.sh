#!/usr/bin/env bash
set -euo pipefail

# Seed production GCP Secret Manager from local .env (operator one-time).
# Usage: ./scripts/provision-production-secrets.sh [middleware-platform/.env]

PROJECT="${GCP_PROJECT:-somo-callsomo}"
ENV_FILE="${1:-middleware-platform/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

KEYS=(
  API_KEY_ENCRYPTION_KEY
  JWT_SECRET
  ADMIN_PORTAL_SECRET
  RETELL_API_KEY
  STEDI_API_KEY
)

for key in "${KEYS[@]}"; do
  val="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//' || true)"
  secret="somo-production-$(echo "$key" | tr '[:upper:]' '[:lower:]' | tr '_' '-')"
  if [[ -z "$val" ]]; then
    case "$key" in
      API_KEY_ENCRYPTION_KEY|JWT_SECRET|ADMIN_PORTAL_SECRET)
        echo "Generate $secret (not in $ENV_FILE)"
        val="$(openssl rand -hex 32)"
        ;;
      *)
        echo "Skip $secret — $key not in $ENV_FILE"
        continue
        ;;
    esac
  fi
  echo "Upsert secret $secret"
  echo -n "$val" | gcloud secrets create "$secret" --project="$PROJECT" --data-file=- --replication-policy=automatic 2>/dev/null \
    || echo -n "$val" | gcloud secrets versions add "$secret" --project="$PROJECT" --data-file=-
done

echo "Done. Bind on deploy with USE_GCP_SECRETS=1 or CLOUDRUN_PRESERVE_ENV=0 full refresh."
