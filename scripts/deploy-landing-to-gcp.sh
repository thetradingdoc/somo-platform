#!/usr/bin/env bash
# Alias: Firebase staging UI deploy (not GCP CDN — see docs/runbooks/CALLSOMO_GCP_CUTOVER.md)
set -euo pipefail
cd "$(dirname "$0")/.."
npm run deploy:staging-hosting
