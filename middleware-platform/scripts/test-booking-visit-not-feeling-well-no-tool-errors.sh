#!/bin/bash
# Regression test: "I'm not feeling well" should enter triage (OPQRST question),
# not fall back to generic "tell me what you need help with" due to tool schema failures.
#
# Usage:
#   ./scripts/test-booking-visit-not-feeling-well-no-tool-errors.sh
#

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-4000}"
DB_FILE="${DB_FILE:-middleware-dev.db}"
API_URL="${API_URL:-http://localhost:${PORT}/api/patient/triage/message}"
HEALTH_URL="${HEALTH_URL:-http://localhost:${PORT}/health}"

SESSION_ID="${1:-}"
if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(sqlite3 "$DB_FILE" "SELECT id FROM patient_portal_sessions WHERE verified = 1 AND revoked_at IS NULL ORDER BY verified_at DESC LIMIT 1;" 2>/dev/null || true)
fi

if [ -z "$SESSION_ID" ]; then
  echo "No valid session found in $DB_FILE"
  exit 1
fi

KELLY_SESSION_ID="$(node -e "const { v4: uuidv4 } = require('uuid'); console.log(uuidv4());")"

TIMEOUT_SECS="${TIMEOUT_SECS:-20}"
CONNECT_TIMEOUT_SECS="${CONNECT_TIMEOUT_SECS:-5}"

# Fail fast if the server is unhealthy (prevents long hangs).
HEALTH_RES="$(curl -sS -m 3 "$HEALTH_URL" || true)"
echo "Server health: ${HEALTH_RES}"

if [[ "${HEALTH_RES}" == *"\"status\":\"unhealthy\""* ]] || [[ "${HEALTH_RES}" == *"unhealthy"* ]]; then
  echo "FAIL: Server is unhealthy; restart server and re-run this test."
  exit 2
fi

turn() {
  local user_msg="$1"
  local payload
  payload="$(jq -n --arg message "$user_msg" --arg sid "$KELLY_SESSION_ID" '{message:$message, session_id:$sid, state:{session_id:$sid}, meta:{}}')"

  resp="$(curl -sS --max-time "$TIMEOUT_SECS" --connect-timeout "$CONNECT_TIMEOUT_SECS" -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "x-session-id: $SESSION_ID" \
    -d "$payload")"

  reply="$(echo "$resp" | jq -r '.reply // ""')"
  echo "User: $user_msg"
  echo "Assistant: $reply"
  echo ""

  # Fail if the system falls back to generic booking without triage.
  echo "$reply" | tr '[:upper:]' '[:lower:]' | rg -i "tell me what you need help with|we'll book a visit|book a visit" >/dev/null && {
    echo "FAIL: Generic non-triage fallback detected."
    exit 1
  }

  # Should ask OPQRST basics in the triage-incomplete / low-confidence path.
  echo "$reply" | tr '[:upper:]' '[:lower:]' | rg -i "(when did|start|feels like|how bad|constant|comes/goes)" >/dev/null && {
    echo "PASS: Looks like triage OPQRST questioning."
    exit 0
  }
}

turn "I'm not feeling well"
turn "I want to book an appointment"

echo "FAIL: Did not reach an OPQRST triage question."
exit 1

