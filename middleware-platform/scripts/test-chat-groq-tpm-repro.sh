#!/bin/bash
# Stress-test Kelly chat prompt size to reproduce Groq TPM rate-limit fallback.
#
# Usage:
#   ./scripts/test-chat-groq-tpm-repro.sh [PORT]
#
# Output:
#   Prints each turn reply and whether it matched the "high demand" fallback.

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${1:-4014}"
PORT="${PORT:-4014}"

DB_FILE="${DB_FILE:-middleware-dev.db}"
API_URL="${API_URL:-http://localhost:${PORT}/api/patient/triage/message}"

portal_session_id="$(sqlite3 "$DB_FILE" "SELECT id FROM patient_portal_sessions WHERE verified = 1 AND revoked_at IS NULL ORDER BY verified_at DESC LIMIT 1;" 2>/dev/null || true)"
if [ -z "$portal_session_id" ]; then
  echo "No verified patient_portal_session found in $DB_FILE"
  exit 1
fi

internal_session_id="$(node -e "const { v4: uuidv4 } = require('uuid'); console.log(uuidv4());")"

echo "portal_session_id=$portal_session_id"
echo "internal_session_id=$internal_session_id"
echo "API_URL=$API_URL"

echo ""

# Use a filler that pushes prompt size, but not absurdly large.
# Tweak these if needed:
FILLER_LEN="${FILLER_LEN:-2500}"
TURNS="${TURNS:-5}"

make_filler() {
  local len="$1"
  perl -e "print 'x' x $len"
}

filler="$(make_filler "$FILLER_LEN")"

for i in $(seq 1 "$TURNS"); do
  # Include the same "general visit" structure from your log, plus a long filler.
  msg="I want to book a general visit. Please help me. ${filler}"
  payload="$(jq -n --arg message "$msg" --arg sid "$internal_session_id" '{message:$message,session_id:$sid,state:{},meta:{}}')"

  echo "Turn $i: sending..."
  resp="$(curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "x-session-id: $portal_session_id" \
    -d "$payload")"

  reply="$(echo "$resp" | jq -r '.reply // empty')"
  echo "Turn $i reply: $reply"
  reply_lc="$(echo "$reply" | tr '[:upper:]' '[:lower:]')"
  if [[ "$reply_lc" == *"high demand"* || \
        "$reply_lc" == *"try again in about 30 minutes"* || \
        "$reply_lc" == *"rate limit"* || \
        "$reply_lc" == *"emergency"* ]]; then
    echo "Turn $i: MATCHED high-demand fallback text"
  fi
  echo ""

  sleep "${SLEEP_BETWEEN_TURNS:-2}"
done

echo "Done."

