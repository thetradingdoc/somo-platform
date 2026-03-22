#!/bin/bash
# Run multiple patient journey test cases (different patients, chief complaints, specialties).
#
# Usage:
#   bash scripts/run-patient-tests.sh                    # Run all cases
#   bash scripts/run-patient-tests.sh back_pain          # Run single case
#   bash scripts/run-patient-tests.sh back_pain rash     # Run specific cases
#
# Requires: jq, sqlite3, curl

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

PORT="${PORT:-4000}"
DB_FILE="${DB_FILE:-middleware-dev.db}"
API_BASE_URL="${API_BASE_URL:-http://localhost:${PORT}}"
API_URL="${API_URL:-http://localhost:${PORT}/api/patient/triage/message}"
HEALTH_URL="${HEALTH_URL:-http://localhost:${PORT}/health}"

DUMMY_IMAGE_PATH="${DUMMY_IMAGE_PATH:-uploads/patients/844a236e-bb91-4477-9b5d-ab6d24d92c15.png}"
SLEEP_BETWEEN_CALLS="${SLEEP_BETWEEN_CALLS:-6}"
MAX_TURNS="${MAX_TURNS:-18}"
TIMEOUT_SECS="${TIMEOUT_SECS:-25}"
CONNECT_TIMEOUT_SECS="${CONNECT_TIMEOUT_SECS:-5}"

# Parse args: [SESSION_ID] [case_id...]
SESSION_ID=""
REQUESTED_CASES=""
for arg in "$@"; do
  case "$arg" in
    back_pain|rash|chest_discomfort|routine_visit|headache|knee_pain|vague_symptoms|spanish)
      REQUESTED_CASES="$REQUESTED_CASES $arg"
      ;;
    *)
      if [ -z "$SESSION_ID" ] && [[ "$arg" =~ ^[0-9a-f-]{36}$ ]]; then
        SESSION_ID="$arg"
      fi
      ;;
  esac
done

if [ -z "$SESSION_ID" ]; then
  SESSION_ID="$(sqlite3 "$DB_FILE" "SELECT id FROM patient_portal_sessions WHERE verified = 1 AND revoked_at IS NULL ORDER BY verified_at DESC LIMIT 1;" 2>/dev/null || true)"
fi

if [ -z "$SESSION_ID" ]; then
  echo "No valid patient_portal_sessions row found in $DB_FILE"
  echo "Usage: $0 [SESSION_ID] [case_id...]"
  echo "  case_id: back_pain, rash, chest_discomfort, routine_visit, headache, knee_pain, vague_symptoms, spanish"
  exit 1
fi

# Source test case definitions
# shellcheck source=scripts/patient-test-cases.env.sh
. "$SCRIPT_DIR/patient-test-cases.env.sh"

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

maybeUploadDummy() {
  if [ "${UPLOAD_DONE:-0}" = "1" ]; then return 0; fi
  if [ ! -f "$DUMMY_IMAGE_PATH" ]; then
    echo "  [WARN] Upload requested but dummy image missing: $DUMMY_IMAGE_PATH"
    return 1
  fi
  echo "  [INFO] Uploading dummy triage media..."
  curl -sS -X POST "${API_BASE_URL}/api/triage/upload" \
    -H "x-session-id: ${KELLY_SESSION_ID}" \
    -F "files=@${DUMMY_IMAGE_PATH};type=image/png" >/dev/null || true
  UPLOAD_DONE="1"
  return 0
}

callAgent() {
  local user_msg="$1"
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

  echo "  User: $user_msg"
  if [ "${#LAST_REPLY}" -gt 250 ]; then
    echo "  Assistant: ${LAST_REPLY:0:250}..."
  else
    echo "  Assistant: $LAST_REPLY"
  fi
  echo ""

  local reply_lc
  reply_lc="$(echo "$LAST_REPLY" | tr '[:upper:]' '[:lower:]')"

  if contains_any "$reply_lc" "verification code" "checkout" "payment link" "paid" "enter the code" "enter code" "code sent"; then
    return 0
  fi

  if [ -n "$(echo "$resp" | jq -r '.redirect_to // empty')" ]; then
    return 0
  fi

  if contains_any "$reply_lc" "tell me what you need help with" "we'll book a visit" "book a visit"; then
    return 2
  fi

  return 1
}

chooseNextUserMessage() {
  if [ "$LAST_NEXT_STEP" = "UPLOAD_IMAGE" ]; then
    maybeUploadDummy || true
    echo "I've uploaded the photo. Proceed with triage and booking."
    return 0
  fi

  local last_lc reply_lc
  last_lc="$(echo "$LAST_REPLY" | tr '[:upper:]' '[:lower:]')"
  reply_lc="$last_lc"

  if contains_any "$last_lc" "upload your photo" "upload your document" "upload area"; then
    maybeUploadDummy || true
    echo "I've uploaded the photo. Proceed with triage and booking."
    return 0
  fi

  # Safety questions (numbness, injury) - answer No to proceed
  if contains_any "$reply_lc" "numbness" "tingling" "weakness" "legs" "bowel" "bladder" "feet"; then
    echo "No."
    return 0
  fi
  if contains_any "$reply_lc" "injury" "caused" "triggered" "lifting" "fall" "twist"; then
    echo "No, it started on its own."
    return 0
  fi

  # Specialty routing
  if contains_any "$reply_lc" "find available slots" "or for another specialty"; then
    echo "${PREFERRED_SPECIALTY:-Primary Care}."
    return 0
  fi
  if contains_any "$reply_lc" "skin specialist" "dermatology"; then
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

  # OPQRST
  if contains_any "$reply_lc" "when did it start" "start time" "how long has it been" "when it started"; then
    echo "${OP_ONSET:-a few days ago}"
    return 0
  fi
  if contains_any "$reply_lc" "what does it feel like" "quality" "itchy" "burning" "sharp" "dull"; then
    echo "${OP_QUALITY:-dull}"
    return 0
  fi
  if contains_any "$reply_lc" "how bad is it" "1 to 10" "severity"; then
    echo "${OP_SEVERITY:-4}"
    return 0
  fi
  if contains_any "$reply_lc" "constant" "comes and goes" "come and go" "timing"; then
    echo "${OP_TIMING:-comes and goes}"
    return 0
  fi

  if contains_any "$reply_lc" "more detail" "describe the pain" "describe your symptoms"; then
    echo "Started ${OP_ONSET:-a few days ago}. It's ${OP_QUALITY:-dull}, ${OP_TIMING:-comes and goes}, severity ${OP_SEVERITY:-4} out of 10, located ${OP_RADIATION:-local}. Provoked by ${OP_PROVOCATION:-activity}."
    return 0
  fi

  # Intake
  if contains_any "$reply_lc" "medications" "on any medications"; then
    echo "I take no medications."
    return 0
  fi
  if contains_any "$reply_lc" "allerg"; then
    echo "I have no allergies."
    return 0
  fi
  if contains_any "$reply_lc" "known conditions" "conditions"; then
    echo "No known conditions."
    return 0
  fi
  if contains_any "$reply_lc" "recent tests" "workups" "prior tests"; then
    echo "No prior tests."
    return 0
  fi

  if contains_any "$reply_lc" "insurance" "member id"; then
    echo "My insurance member ID is 1234567890 with payer Aetna."
    return 0
  fi
  if contains_any "$reply_lc" "email"; then
    echo "${PATIENT_EMAIL:-test@example.com}"
    return 0
  fi

  # Slot selection
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

  if contains_any "$reply_lc" "confirm" "yes"; then
    echo "Yes, please confirm."
    return 0
  fi

  # Lane choice: async vs live video (default to live for quicker test)
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

  echo "Please continue the booking flow."
  return 0
}

runCase() {
  local case_export_fn="$1"
  local case_id case_name
  $case_export_fn
  case_id="$CASE_ID"
  case_name="$CASE_NAME"

  KELLY_SESSION_ID="$(node -e "const { v4: uuidv4 } = require('uuid'); console.log(uuidv4());")"
  UPLOAD_DONE="0"
  LAST_REPLY=""
  LAST_NEXT_STEP=""
  LAST_NEXT_CHIPS_JSON="[]"

  echo ""
  echo "========================================"
  echo "CASE: $case_name ($case_id)"
  echo "========================================"

  local turn msg rc
  for (( turn=0; turn<MAX_TURNS; turn++ )); do
    if [ "$turn" = "0" ]; then
      msg="$FIRST_MESSAGE"
    else
      msg="$(chooseNextUserMessage)"
    fi

    if [[ "$LAST_REPLY" == *"upload"* ]] || [ "$LAST_NEXT_STEP" = "UPLOAD_IMAGE" ]; then
      maybeUploadDummy || true
    fi

    set +e
    callAgent "$msg"
    rc=$?
    set -e

    if [ "$rc" -eq 0 ]; then
      echo "  SUCCESS: Reached checkout / verification-code stage."
      return 0
    fi
    if [ "$rc" -eq 2 ]; then
      echo "  FAIL: Generic fallback detected."
      return 1
    fi

    sleep "$SLEEP_BETWEEN_CALLS"
  done

  echo "  FAIL: Reached MAX_TURNS ($MAX_TURNS) without checkout."
  return 1
}

# --- Main ---

# Resolve which cases to run
CASES_TO_RUN=""
if [ -n "$REQUESTED_CASES" ]; then
  for c in $REQUESTED_CASES; do
    case "$c" in
      back_pain) CASES_TO_RUN="$CASES_TO_RUN export_case_back_pain" ;;
      rash) CASES_TO_RUN="$CASES_TO_RUN export_case_rash" ;;
      chest_discomfort) CASES_TO_RUN="$CASES_TO_RUN export_case_chest_discomfort" ;;
      routine_visit) CASES_TO_RUN="$CASES_TO_RUN export_case_routine_visit" ;;
      headache) CASES_TO_RUN="$CASES_TO_RUN export_case_headache" ;;
      knee_pain) CASES_TO_RUN="$CASES_TO_RUN export_case_knee_pain" ;;
      vague_symptoms) CASES_TO_RUN="$CASES_TO_RUN export_case_vague_symptoms" ;;
      spanish) CASES_TO_RUN="$CASES_TO_RUN export_case_spanish" ;;
    esac
  done
else
  CASES_TO_RUN="$ALL_CASES"
fi

echo "Using portal session: $SESSION_ID"
echo "API: $API_URL"

HEALTH_RES="$(curl -sS -m 3 "$HEALTH_URL" || true)"
if [ "${SKIP_HEALTH_CHECK:-0}" != "1" ]; then
  if [[ "${HEALTH_RES}" == *"\"status\":\"unhealthy\""* ]] || [[ "${HEALTH_RES}" == *"unhealthy"* ]]; then
    echo "FAIL: Server unhealthy. Set SKIP_HEALTH_CHECK=1 to bypass."
    exit 2
  fi
fi

PASSED=0
FAILED=0

for case_fn in $CASES_TO_RUN; do
  if runCase "$case_fn"; then
    ((PASSED++)) || true
  else
    ((FAILED++)) || true
  fi
done

echo ""
echo "========================================"
echo "RESULTS: $PASSED passed, $FAILED failed"
echo "========================================"

[ "$FAILED" -eq 0 ] || exit 1
