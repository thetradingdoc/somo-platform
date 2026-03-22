#!/bin/bash
# End-to-end patient journey test (chat triage -> OPQRST -> upload -> insurance -> slots -> schedule -> checkout).
#
# Acts like a new patient. Stops when checkout is created and a verification code is requested.
#
# Usage:
#   bash ./middleware-platform/scripts/test-full-patient-journey-until-checkout-dynamic.sh [PATIENT_PORTAL_SESSION_ID]
#
# Notes:
# - Requires `jq`, `sqlite3`, and `curl`.
# - Best-effort: if the agent asks additional questions, the script answers with canned responses.

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-4000}"
DB_FILE="${DB_FILE:-middleware-dev.db}"
API_BASE_URL="${API_BASE_URL:-http://localhost:${PORT}}"
API_URL="${API_URL:-http://localhost:${PORT}/api/patient/triage/message}"
HEALTH_URL="${HEALTH_URL:-http://localhost:${PORT}/health}"

# Dummy triage media for integration tests.
DUMMY_IMAGE_PATH="${DUMMY_IMAGE_PATH:-uploads/patients/844a236e-bb91-4477-9b5d-ab6d24d92c15.png}"

SLEEP_BETWEEN_CALLS="${SLEEP_BETWEEN_CALLS:-8}"
MAX_TURNS="${MAX_TURNS:-14}"
TIMEOUT_SECS="${TIMEOUT_SECS:-25}"
CONNECT_TIMEOUT_SECS="${CONNECT_TIMEOUT_SECS:-5}"

SESSION_ID="${1:-}"
if [ -z "$SESSION_ID" ]; then
  SESSION_ID="$(sqlite3 "$DB_FILE" "SELECT id FROM patient_portal_sessions WHERE verified = 1 AND revoked_at IS NULL ORDER BY verified_at DESC LIMIT 1;" 2>/dev/null || true)"
fi

if [ -z "$SESSION_ID" ]; then
  echo "No valid patient_portal_sessions row found in $DB_FILE"
  echo "Provide a session id explicitly: $0 <SESSION_ID>"
  exit 1
fi

KELLY_SESSION_ID="$(node -e "const { v4: uuidv4 } = require('uuid'); console.log(uuidv4());")"

echo "Using patient portal session: $SESSION_ID"
echo "Using kelly triage session_id: $KELLY_SESSION_ID"
echo "API: $API_URL"

HEALTH_RES="$(curl -sS -m 3 "$HEALTH_URL" || true)"
echo "Server health: $HEALTH_RES"
if [ "${SKIP_HEALTH_CHECK:-0}" != "1" ]; then
  if [[ "${HEALTH_RES}" == *"\"status\":\"unhealthy\""* ]] || [[ "${HEALTH_RES}" == *"unhealthy"* ]]; then
    echo "FAIL: Server is unhealthy; restart server and re-run this test. (Or set SKIP_HEALTH_CHECK=1 to bypass)"
    exit 2
  fi
else
  echo "(SKIP_HEALTH_CHECK=1: proceeding despite health status)"
fi

UPLOAD_DONE="0"
LAST_REPLY=""
LAST_NEXT_STEP=""
LAST_NEXT_CHIPS_JSON="[]"

PATIENT_NAME="John Doe"
PATIENT_PHONE="+15551234567"
PATIENT_EMAIL="johndoe@example.com"
INS_MEMBER_ID="1234567890"
INS_PAYER_NAME="Aetna"

# OPQRST canned content.
# Use back pain to avoid upload requirement (rash triggers request_document_upload).
OP_ONSET="3 days ago"
OP_PROVOCATION="worse when bending"
OP_QUALITY="dull ache"
OP_RADIATION="lower back only"
OP_SEVERITY="4"
OP_TIMING="comes and goes"
ASSOCIATED_SX="none else"

ANSWER_NO_MEDS="I take no medications."
ANSWER_NO_ALLERGIES="I have no allergies."
ANSWER_NO_KNOWN_CONDITIONS="No known conditions."
ANSWER_NO_PRIOR_TESTS="No prior tests."
ANSWER_ALCOHOL="0 drinks/week."
ANSWER_SMOKING="Non-smoker."
ANSWER_OCCUPATION="test-worker."
ANSWER_SAFETY="No safety concerns (no thoughts of harming myself)."
ANSWER_FAMILY_HISTORY="None known."
ANSWER_NO_PRIOR_WORKUPS="No recent tests."

maybeUploadDummy() {
  if [ "$UPLOAD_DONE" = "1" ]; then
    return 0
  fi
  if [ ! -f "$DUMMY_IMAGE_PATH" ]; then
    echo "Upload requested but dummy image missing: $DUMMY_IMAGE_PATH"
    return 1
  fi

  echo "Uploading dummy triage media..."
  # Upload expects multipart field `files` (the server accepts /api/triage/upload).
  curl -sS -X POST "${API_BASE_URL}/api/triage/upload" \
    -H "x-session-id: ${KELLY_SESSION_ID}" \
    -F "files=@${DUMMY_IMAGE_PATH};type=image/png" >/dev/null || true
  UPLOAD_DONE="1"
  return 0
}

contains_any() {
  local haystack="$1"
  shift || true
  for needle in "$@"; do
    if [[ -n "$needle" && "$haystack" == *"$needle"* ]]; then
      return 0
    fi
  done
  return 1
}

callAgent() {
  local user_msg="$1"

  # Keep payload compatible with the triage UI: state is an object; provide session_id for continuity.
  local payload
  payload="$(jq -n \
    --arg message "$user_msg" \
    --arg sid "$KELLY_SESSION_ID" \
    '{message:$message, session_id:$sid, state:{session_id:$sid}, meta:{}}')"

  local resp
  resp="$(curl -sS \
    --max-time "$TIMEOUT_SECS" \
    --connect-timeout "$CONNECT_TIMEOUT_SECS" \
    -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "x-session-id: $SESSION_ID" \
    -d "$payload")"

  LAST_REPLY="$(echo "$resp" | jq -r '.reply // ""')"
  LAST_NEXT_STEP="$(echo "$resp" | jq -r '.next_step // empty')"
  LAST_NEXT_CHIPS_JSON="$(echo "$resp" | jq -c '.next_chips // []')"

  local returned_session_id
  returned_session_id="$(echo "$resp" | jq -r '.session_id // empty')"
  if [ -n "$returned_session_id" ]; then
    KELLY_SESSION_ID="$returned_session_id"
  fi

  echo "User: $user_msg"
  echo "Assistant: $LAST_REPLY"
  [ -n "$LAST_NEXT_STEP" ] && echo "next_step: $LAST_NEXT_STEP"
  echo ""

  # Stop when checkout is reached or verification code is requested.
  local reply_lc
  reply_lc="$(echo "$LAST_REPLY" | tr '[:upper:]' '[:lower:]')"
  if contains_any "$reply_lc" \
    "verification code" "checkout" "payment link" "paid" "enter the code" "enter code" "code sent"; then
    echo "SUCCESS: Reached checkout / verification-code stage."
    return 0
  fi

  local redirect_to
  redirect_to="$(echo "$resp" | jq -r '.redirect_to // empty')"
  if [ -n "$redirect_to" ]; then
    echo "SUCCESS: Redirect reached: $redirect_to"
    return 0
  fi

  # Fail on generic fallback.
  if contains_any "$reply_lc" "tell me what you need help with" "we'll book a visit" "book a visit"; then
    echo "FAIL: Generic fallback detected instead of triage/OPQRST flow."
    return 2
  fi

  return 1
}

chooseNextUserMessage() {
  # If upload is requested, do it and return a resume phrase.
  if [ "$LAST_NEXT_STEP" = "UPLOAD_IMAGE" ]; then
    maybeUploadDummy || true
    echo "I've uploaded the photo. Proceed with triage and booking."
    return 0
  fi
  local last_lc
  last_lc="$(echo "$LAST_REPLY" | tr '[:upper:]' '[:lower:]')"
  if contains_any "$last_lc" "upload your photo" "upload your document" "upload area"; then
    maybeUploadDummy || true
    echo "I've uploaded the photo. Proceed with triage and booking."
    return 0
  fi

  local reply_lc
  reply_lc="$(echo "$LAST_REPLY" | tr '[:upper:]' '[:lower:]')"

  # Specialty routing decision: the assistant asks which specialty to book first
  # before it calls get_available_slots.
  if contains_any "$reply_lc" "find available slots" "or for another specialty"; then
    if contains_any "$reply_lc" "dermatology"; then
      echo "Dermatology."
    else
      echo "Primary specialty."
    fi
    return 0
  fi

  # Specialty suggestion without an explicit routing question.
  if contains_any "$reply_lc" "skin specialist" "dermatology"; then
    # Keep this as a specialty confirmation, not a booking directive.
    echo "Dermatology."
    return 0
  fi
  if contains_any "$reply_lc" "primary care physician" "primary care"; then
    echo "Primary Care."
    return 0
  fi
  if contains_any "$reply_lc" "orthopedic" "orthopedics" "bone" "joint"; then
    echo "Orthopedics."
    return 0
  fi
  if contains_any "$reply_lc" "heart specialist" "cardiology"; then
    echo "Cardiology."
    return 0
  fi

  if contains_any "$reply_lc" "when did it start" "start time" "how long has it been" "how long has" "when it started"; then
    echo "$OP_ONSET"
    return 0
  fi
  if contains_any "$reply_lc" "what does it feel like" "what does it feel" "quality" "itchy" "burning" "sharp" "dull"; then
    echo "$OP_QUALITY"
    return 0
  fi
  if contains_any "$reply_lc" "how bad is it" "1 to 10" "severity"; then
    echo "$OP_SEVERITY"
    return 0
  fi
  if contains_any "$reply_lc" "constant" "comes and goes" "come and go" "timing"; then
    echo "$OP_TIMING"
    return 0
  fi

  # Low-confidence triage clarifier (from run_triage_rag):
  # "Can you describe the pain in more detail?" / "Is it on both sides or one side?"
  if contains_any "$reply_lc" "more detail" "describe the pain" "describe your symptoms"; then
    # Provide a richer recap so RAG confidence can move above threshold.
    # (The agent’s suggested_next_step often includes multiple example cues.)
    echo "Started $OP_ONSET. It's $OP_QUALITY, $OP_TIMING, severity $OP_SEVERITY out of 10, located $OP_RADIATION. Provoked by $OP_PROVOCATION."
    return 0
  fi

  if contains_any "$reply_lc" "medications" "on any medications"; then
    echo "$ANSWER_NO_MEDS"
    return 0
  fi
  if contains_any "$reply_lc" "allerg"; then
    echo "$ANSWER_NO_ALLERGIES"
    return 0
  fi
  if contains_any "$reply_lc" "known conditions" "conditions"; then
    echo "$ANSWER_NO_KNOWN_CONDITIONS"
    return 0
  fi
  if contains_any "$reply_lc" "recent tests" "workups" "prior tests"; then
    echo "$ANSWER_NO_PRIOR_WORKUPS"
    return 0
  fi

  if contains_any "$reply_lc" "insurance" "member id" "member_id"; then
    echo "My insurance member ID is $INS_MEMBER_ID with payer $INS_PAYER_NAME."
    return 0
  fi
  if contains_any "$reply_lc" "email"; then
    echo "$PATIENT_EMAIL"
    return 0
  fi

  # Slot selection: choose first slot chip if present.
  local slot_value
  slot_value="$(echo "$LAST_NEXT_CHIPS_JSON" | jq -r '[.[]? | select(.action=="select_slot" or .slot!=null) | (.value // .slot.display // .slot.time // .slot.start_time // .label // empty)][0] // empty')"
  if [ -n "$slot_value" ]; then
    echo "$slot_value"
    return 0
  fi
  if contains_any "$reply_lc" "what time" "select a time" "choose a time" "time slot"; then
    echo "The first available time."
    return 0
  fi

  # Resume / confirmation.
  if contains_any "$reply_lc" "confirm" "yes"; then
    echo "Yes, please confirm."
    return 0
  fi

  # Lane choice: async vs live video
  if contains_any "$reply_lc" "lower-cost" "async" "4-24" "specialist review" "option 1"; then
    echo "Lower-cost review."
    return 0
  fi
  if contains_any "$reply_lc" "live video" "sync" "real-time" "option 2"; then
    echo "Live video visit."
    return 0
  fi
  if contains_any "$reply_lc" "which one" "which option" "would you prefer" "choose one" "which would"; then
    echo "Live video visit."
    return 0
  fi

  # Safety questions (numbness, injury) - answer No to proceed
  if contains_any "$reply_lc" "numbness" "tingling" "weakness" "legs" "bowel" "bladder"; then
    echo "No."
    return 0
  fi
  if contains_any "$reply_lc" "injury" "caused" "triggered" "lifting" "fall"; then
    echo "No, it started on its own."
    return 0
  fi

  # Default: provide next missing common pieces.
  # (This is intentionally conservative to avoid worsening rate-limit pressure.)
  echo "Please continue the booking flow."
  return 0
}

echo "Starting journey..."

for (( turn=0; turn<MAX_TURNS; turn++ )); do
  if [ "$turn" = "0" ]; then
    # fix-test-msg: cash-only flow — remove insurance from first message
    msg="I want to book a visit. I have lower back pain. Onset: $OP_ONSET. Provocation: $OP_PROVOCATION. Quality: $OP_QUALITY. Radiation: $OP_RADIATION. Severity: $OP_SEVERITY. Timing: $OP_TIMING. Associated: $ASSOCIATED_SX. No medications. No allergies. No known conditions. Alcohol: $ANSWER_ALCOHOL Smoking: $ANSWER_SMOKING. Name: $PATIENT_NAME. Phone: $PATIENT_PHONE. Email: $PATIENT_EMAIL."
  else
    msg="$(chooseNextUserMessage)"
  fi

  # If last reply suggests upload, we upload before calling.
  if [[ "$LAST_REPLY" == *"upload"* ]] || [ "$LAST_NEXT_STEP" = "UPLOAD_IMAGE" ]; then
    maybeUploadDummy || true
  fi

  set +e
  callAgent "$msg"
  rc="$?"
  set -e

  if [ "$rc" -eq 0 ]; then
    echo "Test complete."
    exit 0
  fi
  if [ "$rc" -eq 2 ]; then
    echo "Test failed due to generic fallback. Dumping last state for debugging."
    echo "Last next_step: $LAST_NEXT_STEP"
    echo "Last reply: $LAST_REPLY"
    echo "Last chips: $LAST_NEXT_CHIPS_JSON"
    exit 1
  fi

  sleep "$SLEEP_BETWEEN_CALLS"
done

echo "FAIL: Reached MAX_TURNS ($MAX_TURNS) without getting to checkout."
echo "Last next_step: $LAST_NEXT_STEP"
echo "Last reply: $LAST_REPLY"
echo "Last chips: $LAST_NEXT_CHIPS_JSON"
exit 1

