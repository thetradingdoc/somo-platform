#!/bin/bash
# Regression test for "book a visit" with minimal/no symptoms.
#
# Goal:
# 1) Agent should NOT spam `get_available_slots` while triage is incomplete.
# 2) Agent should end up asking OPQRST (onset/quality/severity/timing) to collect
#    the missing details needed for safe routing/booking.
# 3) Agent should NOT fall back to the "high demand" rate-limit message.
#
# Usage:
#   ./scripts/test-booking-visit-without-symptoms-no-slot-spam.sh [SESSION_ID]
#

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-4000}"
DB_FILE="${DB_FILE:-middleware-dev.db}"
API_URL="${API_URL:-http://localhost:${PORT}/api/patient/triage/message}"

SESSION_ID="${1:-}"
if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(sqlite3 "$DB_FILE" "SELECT id FROM patient_portal_sessions WHERE verified = 1 AND revoked_at IS NULL ORDER BY verified_at DESC LIMIT 1;" 2>/dev/null || true)
fi

if [ -z "$SESSION_ID" ]; then
  echo "No valid session. Get one with:"
  echo "  sqlite3 \"$DB_FILE\" \"SELECT id FROM patient_portal_sessions WHERE verified = 1 AND revoked_at IS NULL LIMIT 1;\""
  exit 1
fi

echo "Using session: $SESSION_ID"
echo "API: $API_URL"
echo ""

KELLY_SESSION_ID="$(node -e "const { v4: uuidv4 } = require('uuid'); console.log(uuidv4());")"

MAX_TURNS="${MAX_TURNS:-4}"
SLEEP_BETWEEN_CALLS="${SLEEP_BETWEEN_CALLS:-6}"

OPQRST_REGEX='(when did|start|feels like|what does|how bad|on a scale|constant|comes/goes)'
HIGH_DEMAND_REGEX='(high demand|try again in about 30 minutes|rate limit)'
SLOTS_SPAM_REGEX='(available time|available time\\(s\\)|time you prefer|slot|slots|schedule)'
TOOL_NAME_LEAK_REGEX='(run_triage_rag|get_available_slots|schedule_appointment|collect_insurance|create_appointment_checkout)'

turn() {
  local user_msg="$1"
  local payload

  payload="$(jq -n --arg message "$user_msg" --arg sid "$KELLY_SESSION_ID" '{message:$message, session_id:$sid, state:{session_id:$sid}, meta:{}}')"

  echo "User: $user_msg"
  local res
  res="$(curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "x-session-id: $SESSION_ID" \
    -d "$payload")"

  local reply
  reply="$(echo "$res" | jq -r '.reply // empty')"

  echo "Assistant: $reply"
  echo ""

  if echo "$reply" | tr '[:upper:]' '[:lower:]' | rg -i "$HIGH_DEMAND_REGEX" >/dev/null; then
    echo "FAIL: Hit high-demand/rate-limit fallback."
    exit 1
  fi

  if echo "$reply" | tr '[:upper:]' '[:lower:]' | rg -i "$SLOTS_SPAM_REGEX" >/dev/null; then
    echo "FAIL: Assistant appears to be offering slots before triage completion."
    exit 1
  fi

  if echo "$reply" | rg -i "$TOOL_NAME_LEAK_REGEX" >/dev/null; then
    echo "FAIL: Assistant reply leaks internal tool/function names."
    exit 1
  fi

  # One-question-at-a-time heuristic for voice/chat: avoid multiple '?' in a single turn.
  local qcount
  qcount="$(echo "$reply" | tr -cd '?' | wc -c | tr -d ' ')"
  if [ "${qcount:-0}" -gt 1 ]; then
    echo "FAIL: Assistant asked more than one question in a single reply."
    exit 1
  fi

  if echo "$reply" | tr '[:upper:]' '[:lower:]' | rg -i "$OPQRST_REGEX" >/dev/null; then
    echo "PASS: Assistant asked for OPQRST-style details."
    exit 0
  fi
}

turn_idx=0
while [ "$turn_idx" -lt "$MAX_TURNS" ]; do
  if [ "$turn_idx" -eq 0 ]; then
    # Minimal intent: book a visit, but do NOT provide symptoms.
    turn "Hi, I want to book a visit."
  elif [ "$turn_idx" -eq 1 ]; then
    turn "Yes, I want to book. I don't know what details you need yet."
  else
    turn "Can you help me book? Please ask whatever questions you need."
  fi

  turn_idx=$((turn_idx + 1))
  sleep "$SLEEP_BETWEEN_CALLS"
done

echo "FAIL: Did not reach an OPQRST-asking reply within $MAX_TURNS turns."
exit 1

