# Cloud Run deploy targets — Somo (source before use).

export CLOUDRUN_GCP_PROJECT="${CLOUDRUN_GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-somo-callsomo}}"
export CLOUDRUN_REGION="${CLOUDRUN_REGION:-us-central1}"
export CLOUDRUN_SERVICE="${CLOUDRUN_SERVICE:-somo-middleware}"
export CLOUDRUN_API_HOST="${CLOUDRUN_API_HOST:-https://api.callsomo.com}"

# Voice scale (Interpretation C): bind REDIS_URL via Secret Manager in generate-cloudrun-env-yaml.cjs
# (secret id default: somo-staging-redis-url). Do not scale min-instances > 1 until /health voice_redis is healthy.
export VOICE_RATE_LIMIT_BACKEND="${VOICE_RATE_LIMIT_BACKEND:-redis}"
