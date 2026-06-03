# Cloud Run deploy targets — Somo (source before use).

export CLOUDRUN_GCP_PROJECT="${CLOUDRUN_GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-somo-callsomo}}"
export CLOUDRUN_REGION="${CLOUDRUN_REGION:-us-central1}"
export CLOUDRUN_SERVICE="${CLOUDRUN_SERVICE:-somo-middleware}"
export CLOUDRUN_API_HOST="${CLOUDRUN_API_HOST:-https://api.callsomo.com}"
