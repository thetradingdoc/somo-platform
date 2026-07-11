# Cloud Run deploy targets — Somo (source before use).

export CLOUDRUN_GCP_PROJECT="${CLOUDRUN_GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-somo-callsomo}}"
export CLOUDRUN_REGION="${CLOUDRUN_REGION:-us-central1}"
export CLOUDRUN_SERVICE="${CLOUDRUN_SERVICE:-somo-middleware}"
export CLOUDRUN_API_HOST="${CLOUDRUN_API_HOST:-https://api.callsomo.com}"

# Voice scale (Interpretation C): use redis only after REDIS_URL secret exists in Secret Manager
# (somo-production-redis-url / somo-staging-redis-url). Until then, memory backend is safe for min-instances=1.
export VOICE_RATE_LIMIT_BACKEND="${VOICE_RATE_LIMIT_BACKEND:-memory}"
export CLOUDRUN_MEMORY="${CLOUDRUN_MEMORY:-8Gi}"
export CLOUDRUN_CPU="${CLOUDRUN_CPU:-4}"
