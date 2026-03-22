#!/usr/bin/env bash
# Kelly — Single Case Debug Runner
# Usage: bash scripts/run-single.sh <case_id> [--verbose]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

CASE_ID="${1:-back_pain_en}"
shift || true

VERBOSE_FLAG="0"
if [[ "${1:-}" == "--verbose" ]]; then
  VERBOSE_FLAG="1"
fi

if [[ "$VERBOSE_FLAG" == "1" ]]; then
  exec bash "$SCRIPT_DIR/run-kelly-tests.sh" "$CASE_ID" --verbose
else
  exec bash "$SCRIPT_DIR/run-kelly-tests.sh" "$CASE_ID"
fi

