#!/bin/bash
# User-journey style test: triage (OPQRST) -> specialty routing -> slots -> scheduling -> checkout.
# This is a best-effort integration test against the running middleware server.
#
# Usage:
#   ./scripts/test-booking-journey-until-checkout.sh [SESSION_ID]
#
# If SESSION_ID is not provided, it auto-picks a verified patient_portal_session from sqlite.

set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-4000}"
DB_FILE="${DB_FILE:-middleware-dev.db}"
API_URL="${API_URL:-http://localhost:${PORT}/api/patient/triage/message}"
API_BASE_URL="${API_BASE_URL:-http://localhost:${PORT}}"

# Dummy triage media for integration testing. Uses whatever image you already have in uploads/.
DUMMY_IMAGE_PATH="${DUMMY_IMAGE_PATH:-uploads/patients/844a236e-bb91-4477-9b5d-ab6d24d92c15.png}"

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

sleep_between_calls="${SLEEP_BETWEEN_CALLS:-8}"

UPLOAD_COMPLETED="${UPLOAD_COMPLETED:-0}"
LAST_REPLY=""
LAST_NEXT_STEP=""

maybeUploadDummyTriageMedia() {
  # Trigger when the agent requests a photo upload.
  if [ "${UPLOAD_COMPLETED}" = "1" ]; then
    return 0
  fi

  if [ -z "${KELLY_SESSION_ID:-}" ]; then
    echo "Upload requested but KELLY_SESSION_ID not set yet; skipping upload."
    return 1
  fi

  if [ ! -f "$DUMMY_IMAGE_PATH" ]; then
    echo "Upload requested but dummy image not found at: $DUMMY_IMAGE_PATH"
    return 1
  fi

  echo "Uploading dummy triage media to unblock flow..."
  # /api/triage/upload expects multipart form field `files[]`
  # and uses `x-session-id` to attach the media to the current triage session.
  local upload_res
  upload_res="$(
    curl -s -X POST "${API_BASE_URL}/api/triage/upload" \
      -H "x-session-id: ${KELLY_SESSION_ID}" \
      -F "files=@${DUMMY_IMAGE_PATH};type=image/png"
  )"
  echo "Upload response: ${upload_res}"
  UPLOAD_COMPLETED=1
  return 0
}

turn() {
  local user_msg="$1"
  local payload
  if [ -n "${KELLY_SESSION_ID:-}" ]; then
    payload="$(jq -n --arg message "$user_msg" --arg sid "$KELLY_SESSION_ID" '{message:$message, session_id:$sid, state:{session_id:$sid}, meta:{}}')"
  else
    payload="$(jq -n --arg message "$user_msg" '{message:$message,state:{},meta:{}}')"
  fi

  echo "User: $user_msg"

  local res
  res="$(curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "x-session-id: $SESSION_ID" \
    -d "$payload")"

  echo "Raw response: $res"

  local reply
  reply="$(echo "$res" | jq -r '.reply // ""')"
  LAST_REPLY="$reply"
  local step
  step="$(echo "$res" | jq -r '.state.step // empty')"
  local next_step
  next_step="$(echo "$res" | jq -r '.next_step // empty')"
  LAST_NEXT_STEP="$next_step"
  local redirect_to
  redirect_to="$(echo "$res" | jq -r '.redirect_to // empty')"

  local response_session_id
  response_session_id="$(echo "$res" | jq -r '.session_id // empty')"
  if [ -z "${KELLY_SESSION_ID:-}" ] && [ -n "$response_session_id" ]; then
    KELLY_SESSION_ID="$response_session_id"
    echo "Kelly session_id persisted: $KELLY_SESSION_ID"
  fi

  echo "Assistant reply: $reply"
  [ -n "$step" ] && echo "state.step: $step"
  [ -n "$next_step" ] && echo "next_step: $next_step"
  [ -n "$redirect_to" ] && echo "redirect_to: $redirect_to"
  echo ""

  # Stop when we appear to have reached the checkout/payment stage.
  if echo "$res" | jq -e '.reply | test("verification code|checkout|payment link|paid"; "i")' >/dev/null; then
    return 0
  fi
  if echo "$next_step" | jq -e 'test("checkout|payment"; "i")' >/dev/null; then
    return 0
  fi
  return 1
}

MAX_TURNS="${MAX_TURNS:-5}"

# Keep messages relatively compact to reduce token-rate-limit risk.
turn_idx=0
while [ "$turn_idx" -lt "$MAX_TURNS" ]; do
  if [[ "${LAST_REPLY:-}" == *"upload your photo"* ]] || [ "${LAST_NEXT_STEP}" = "UPLOAD_IMAGE" ]; then
    # If the model is still asking for the upload, repeat the explicit resume phrase.
    msg="I've uploaded the photo. Proceed with triage and book the first available slot."
  elif [ "$turn_idx" -eq 0 ]; then
    # Primary request with explicit OPQRST + rich intake + insurance + contacts.
    # The agent should store OPQRST, call run_triage_rag, then proceed to slots/booking/checkout.
    msg="Hi, I want to book a general visit. I have a rash on my face for 2 days. Onset: started 2 days ago. Provocation: worse after new skincare. Quality: itchy/burning. Radiation: only on forehead. Severity: 5. Timing: constant. Associated symptoms: none else. I take no medications, and I have no allergies. No known conditions or prior tests. Alcohol: 0 drinks/week, non-smoker. No safety concerns (no thoughts of harming myself). Insurance: member ID 1234567890, payer Aetna. Name John Doe. Phone +15551234567. Email johndoe@example.com. Book the first available time."
  elif [ "$turn_idx" -eq 1 ]; then
    msg="I've uploaded the photo. Please continue triage and booking. If you list times, choose the first available slot."
  elif [ "$turn_idx" -eq 2 ]; then
    msg="Rash details (for triage after photo upload): onset 2 days ago, worse after new skincare, itchy/burning on forehead only, severity 5/10, constant, no meds, no allergies. Proceed with triage and book the first available slot."
  elif [ "$turn_idx" -eq 3 ]; then
    msg="Yes—use my provided details and proceed to the payment checkout."
  else
    msg="Proceed to checkout."
  fi

  if turn "$msg"; then
    echo "Checkout appears to be reached. Stopping."
    break
  fi

  # If the agent is blocked waiting for a photo upload, upload a dummy photo now.
  if [[ "$LAST_REPLY" == *"upload your photo"* ]] || [ "${LAST_NEXT_STEP}" = "UPLOAD_IMAGE" ]; then
    maybeUploadDummyTriageMedia || true
  fi

  turn_idx=$((turn_idx + 1))
  sleep "$sleep_between_calls"
done

echo "Done."

