#!/usr/bin/env bash
# Alias: Firebase staging UI deploy (not GCP CDN — see STAGING_MYSKINANDCARE.md)
set -euo pipefail
cd "$(dirname "$0")/.."
npm run deploy:staging-hosting
