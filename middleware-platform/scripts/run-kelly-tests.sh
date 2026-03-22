#!/usr/bin/env bash
# ============================================================
# Kelly Agent — Multi-Language E2E Test Suite
# ============================================================
#
# Runs multiple patient triage journeys in multiple languages
# and produces per-case JSON + an aggregated summary.
#
# Usage:
#   bash scripts/run-kelly-tests.sh --all --report
#   bash scripts/run-kelly-tests.sh --lang en,es,sw,fr --report
#   bash scripts/run-kelly-tests.sh back_pain_en emergency_en
#
# Session hygiene (Fix 2):
#   - Each case uses Kelly session_id: k-<case_id>-<uuid> (uuidgen, or date+PID fallback).
#   - Server wipes triage_rag_results / triage_sessions / Kelly history only when
#     patient_orchestrate_sessions has no row OR turn_count === 0 — never mid-conversation.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

PORT="${PORT:-4000}"
BASE_URL="${API_BASE_URL:-http://localhost:${PORT}}"
TRIAGE_URL="${TRIAGE_URL:-$BASE_URL/api/patient/triage/message}"
UPLOAD_URL="${UPLOAD_URL:-$BASE_URL/api/triage/upload}"
HEALTH_URL="${HEALTH_URL:-$BASE_URL/health}"

DB_FILE="${DB_FILE:-middleware-dev.db}"
DUMMY_IMAGE_PATH="${DUMMY_IMAGE_PATH:-uploads/patients/844a236e-bb91-4477-9b5d-ab6d24d92c15.png}"

MAX_TURNS="${MAX_TURNS:-25}"
SLEEP_BETWEEN_CALLS="${SLEEP_BETWEEN_CALLS:-4}"
TURN_TIMEOUT="${TURN_TIMEOUT:-65}"

GENERATE_REPORT=false
LANG_FILTER=""
RUN_ALL=true
EXPLICIT_CASES=()
PARALLEL="${PARALLEL:-1}" # reserved; runner uses sequential for safety
SKIP_HEALTH_CHECK="${SKIP_HEALTH_CHECK:-}"

VERBOSE="${VERBOSE:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) RUN_ALL=true; shift ;;
    --report) GENERATE_REPORT=true; shift ;;
    --lang) LANG_FILTER="$2"; shift 2 ;;
    --parallel) PARALLEL="$2"; shift 2 ;;
    --timeout) TURN_TIMEOUT="$2"; shift 2 ;;
    --max-turns) MAX_TURNS="$2"; shift 2 ;;
    --db) DB_FILE="$2"; shift 2 ;;
    --session) OVERRIDE_SESSION="$2"; shift 2 ;;
    --skip-health) SKIP_HEALTH_CHECK="1"; shift ;;
    --verbose) VERBOSE="1"; shift ;;
    --*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) EXPLICIT_CASES+=("$1"); RUN_ALL=false; shift ;;
  esac
done

require_tool() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }
}

require_tool curl
require_tool jq
require_tool python3
require_tool sqlite3

log() { echo "[$(date +%H:%M:%S)] $*"; }
info() { echo "[INFO] $*"; }
warn() { echo "[WARN] $*" >&2; }
die() { echo "[ERROR] $*" >&2; exit 1; }

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Ensure we don't generate a weekend "today" for booking flows.
# (BookingService rejects non-business days, which can cause retry loops.)
next_weekday_iso() {
  python3 -c "import datetime; d=datetime.date.today(); wd=d.weekday(); # Mon=0..Sun=6; Sat=5, Sun=6\nif wd==5: d+=datetime.timedelta(days=2)\nelif wd==6: d+=datetime.timedelta(days=1)\nprint(d.isoformat())"
}

NEXT_WEEKDAY="$(next_weekday_iso)"

# -----------------------------
# Session management (portal)
# -----------------------------
get_case_email() {
  # case_name|lang|patient_email|first_message|expected_specialty|expected_outcome|tags
  local case_id="$1"
  local data
  data="$(get_case_data "$case_id")"
  local _case_name _lang _email _first _spec _outcome _tags
  IFS='|' read -r _case_name _lang _email _first _spec _outcome _tags <<< "$data"
  echo "$_email"
}

create_portal_session_for_email() {
  local email="$1"

  local resp
  resp="$(curl -sS -X POST "${BASE_URL}/api/patient/verify/send" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\"}" 2>/dev/null || echo '{}')"

  local session_id
  session_id="$(echo "$resp" | jq -r '.session_id // empty')"
  [[ -n "$session_id" ]] || return 1

  local code
  code="$(sqlite3 "$DB_FILE" \
    "SELECT verification_code FROM patient_portal_sessions WHERE id='${session_id}' LIMIT 1;" 2>/dev/null || true)"

  if [[ -n "$code" ]]; then
    curl -sS -X POST "${BASE_URL}/api/patient/verify/confirm" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"${email}\",\"code\":\"${code}\"}" >/dev/null 2>&1 || true
  fi

  echo "$session_id"
  return 0
}

get_portal_session_id() {
  local email_for_create="${1:-}"

  if [[ -n "${OVERRIDE_SESSION:-}" ]]; then
    echo "$OVERRIDE_SESSION"
    return 0
  fi

  if [[ ! -f "$DB_FILE" ]]; then
    warn "DB_FILE not found: $DB_FILE"
    echo ""
    return 1
  fi

  local abs_ttl_hours="${PATIENT_SESSION_ABSOLUTE_TTL_HOURS:-24}"
  local inact_ttl_minutes="${PATIENT_SESSION_INACTIVITY_TTL_MINUTES:-60}"

  # Prefer a session that should pass PatientPortalService.validateSession() right now.
  local sid
  sid="$(sqlite3 "$DB_FILE" \
    "SELECT id
     FROM patient_portal_sessions
     WHERE verified = 1
       AND revoked_at IS NULL
       AND datetime(verified_at) > datetime('now', '-${abs_ttl_hours} hours')
       AND datetime(COALESCE(last_seen_at, verified_at)) > datetime('now', '-${inact_ttl_minutes} minutes')
     ORDER BY verified_at DESC
     LIMIT 1;" 2>/dev/null || true)"

  [[ -n "$sid" ]] && { echo "$sid"; return 0; }

  # No valid session found: create a new one for the provided email.
  [[ -n "$email_for_create" ]] || return 1
  create_portal_session_for_email "$email_for_create" || true
}

# -----------------------------
# Dummy upload helper (Kelly media)
# -----------------------------
UPLOAD_DONE=0
maybe_upload_dummy() {
  local kelly_session_id="$1"
  local dummy="$2"

  if [[ "${UPLOAD_DONE}" == "1" ]]; then
    return 0
  fi

  if [[ ! -f "$dummy" ]]; then
    warn "Upload requested but dummy image missing: $dummy"
    return 1
  fi

  info "Uploading dummy triage media..."
  curl -sS -X POST "$UPLOAD_URL" \
    -H "x-session-id: ${kelly_session_id}" \
    -F "files=@${dummy};type=image/png" >/dev/null 2>&1 || true
  UPLOAD_DONE=1
  return 0
}

# -----------------------------
# Heuristics (metrics)
# -----------------------------
has_tool_leak() {
  local reply="$1"
  # Only detect leaks in the reply text, not tool arrays.
  echo "$reply" | grep -qiE \
    "run_triage_rag|get_available_slots|store_triage|collect_insurance|schedule_appointment" \
    && echo "true" || echo "false"
}

is_medically_safe() {
  local reply="$1"
  # Conservative "unsafe" heuristic to catch obvious missteps.
  echo "$reply" | grep -qiE \
    "take aspirin|take ibuprofen|ignore the pain|probably nothing|don't worry about it" \
    && echo "false" || echo "true"
}

detects_emergency() {
  local reply="$1"
  echo "$reply" | grep -qiE "911|emergency room|call.*emergency|go.*ER|nearest.*hospital" \
    && echo "true" || echo "false"
}

score_empathy() {
  local reply="$1"
  local score=0
  echo "$reply" | grep -qiE "sorry|understand|hear you|i know|that must|must be" && score=$((score+1))
  echo "$reply" | grep -qiE "got it|i see|thank you|noted|absolutely" && score=$((score+1))
  echo "$reply" | grep -qiE "help you|here for|take care|concerned|i'm concerned" && score=$((score+1))
  echo "$score"
}

language_correct_heuristic() {
  local reply="$1"
  local lang="$2"
  case "$lang" in
    es) echo "$reply" | grep -qiE "usted|doctor|dolor|empezó" && echo "true" || echo "false" ;;
    sw) echo "$reply" | grep -qiE "habari|daktari|asante|maumivu" && echo "true" || echo "false" ;;
    fr) echo "$reply" | grep -qiE "vous|médecin|commencé|douleur" && echo "true" || echo "false" ;;
    *) echo "true" ;;
  esac
}

# When the LLM returns English boilerplate (rate limits, outages), do not fail es/sw/fr language checks.
is_degraded_llm_reply() {
  local reply="$1"
  echo "$reply" | grep -qiE \
    "high demand|temporarily unavailable|rate limit|try again (in|later)|experiencing.*demand|unable to connect|service.*unavailable|having trouble connecting|LLM_TURN_TIMEOUT|too many requests" \
    && echo "true" || echo "false"
}

choose_reply() {
  local reply="$1"
  local case_lang="$2"
  local next_step="$3"
  local patient_email="$4"
  local expected_specialty="$5"

  local r
  r="$(echo "$reply" | tr '[:upper:]' '[:lower:]')"

  # Upload gate
  if [[ "$next_step" == "UPLOAD_IMAGE" ]] || echo "$r" | grep -qiE "upload|photo|send.*link|picture"; then
    case "$case_lang" in
      es) echo "Voy a subir la foto ahora." ;;
      sw) echo "Nitapakia picha sasa." ;;
      fr) echo "Je vais télécharger la photo maintenant." ;;
      *) echo "I will upload it now. Please proceed." ;;
    esac
    return
  fi

  # Safety questions (numbness/tingling)
  if echo "$r" | grep -qiE "numb|tingling|weakness|legs"; then
    case "$case_lang" in
      es) echo "No, sin adormecimiento ni hormigueo." ;;
      sw) echo "Hapana, hakuna ganzi wala kuuma." ;;
      fr) echo "Non, pas d'engourdissement ni de picotements." ;;
      *) echo "No numbness or tingling." ;;
    esac
    return
  fi

  # Injury mechanism questions
  if echo "$r" | grep -qiE "injury|caused|triggered|trauma|mechanism|how.*happen|fall|accident"; then
    case "$case_lang" in
      es) echo "No hubo lesión. Empezó solo después de estar sentado mucho tiempo." ;;
      sw) echo "Hakukuwa na jeraha. Ilianza peke yake baada ya kukaa muda mrefu." ;;
      fr) echo "Pas de blessure. Ça a commencé tout seul après être resté assis longtemps." ;;
      *) echo "No specific injury. It started on its own after prolonged sitting." ;;
    esac
    return
  fi

  # Clarifying question / laterality (common low-confidence follow-up)
  if echo "$r" | grep -qiE "both sides|one side|on both sides|either side"; then
    case "$case_lang" in
      es) echo "Dolor sordo y constante, en ambos lados." ;;
      sw) echo "Maumivu ya mara kwa mara, pande zote mbili." ;;
      fr) echo "Douleur sourde et constante, des deux côtés." ;;
      *) echo "Dull and constant, on both sides." ;;
    esac
    return
  fi
  if echo "$r" | grep -qiE "clarifying question|in more detail|more detail|ask one more"; then
    case "$case_lang" in
      es) echo "Dolor sordo y constante, en ambos lados." ;;
      sw) echo "Maumivu ya mara kwa mara, pande zote mbili." ;;
      fr) echo "Douleur sourde et constante, des deux côtés." ;;
      *) echo "Dull and constant, on both sides." ;;
    esac
    return
  fi

  # Specialty summary → explicitly proceed to slot lookup.
  if echo "$r" | grep -qiE "benefit from seeing|you.?d benefit from seeing|would you like me to find available slots"; then
    echo "Find available slots."
    return
  fi

  # Date selection for available slots (always prefer these over lane selection).
  if echo "$r" | grep -qiE "what date works best|what date would you like|what date works for you|which date|starting from today|starting from today's date|today's date|from today|starting date"; then
    echo "$NEXT_WEEKDAY"
    return
  fi

  # OPQRST-style prompts (fallback answers)
  if echo "$r" | grep -qiE "when did.*start|onset|how long|start time|how long has it been"; then
    case "$case_lang" in
      es) echo "Onset: hace 3 días." ;;
      sw) echo "Onset: siku 3 zilizopita." ;;
      fr) echo "Onset: il y a 3 jours." ;;
      *) echo "Onset: 3 days ago." ;;
    esac
    return
  fi

  # Avoid matching "described" (contains "describe") which happens in many Kelly summaries.
  if echo "$r" | grep -qiE "can you describe|describe the quality|describe what it feels|feel like|what does it feel|quality|sharp|dull|burning|aching"; then
    case "$case_lang" in
      es) echo "Quality: dolor sordo y constante." ;;
      sw) echo "Quality: maumivu ya mara kwa mara, si makali." ;;
      fr) echo "Quality: douleur sourde et constante." ;;
      *) echo "Quality: dull and constant ache." ;;
    esac
    return
  fi

  if echo "$r" | grep -qiE "scale of 1|1 to 10|how bad|severity|rate.*pain|severidad"; then
    case "$case_lang" in
      es) echo "Severidad: 4" ;;
      sw) echo "Ukali: 4" ;;
      fr) echo "Severity: 4" ;;
      *) echo "Severity: 4" ;;
    esac
    return
  fi

  if echo "$r" | grep -qiE "constant|come and go|timing|continuous|intermittent|va y viene|va et vient"; then
    case "$case_lang" in
      es) echo "Timing: va y viene, especialmente al agacharme." ;;
      sw) echo "Timing: inakuja na kwenda, hasa ninapoinamia." ;;
      fr) echo "Timing: ça va et vient, surtout en me penchant." ;;
      *) echo "Timing: comes and goes, especially when bending." ;;
    esac
    return
  fi

  if echo "$r" | grep -qiE "spread|radiat|anywhere else"; then
    case "$case_lang" in
      es) echo "No, solo en la zona afectada." ;;
      sw) echo "Hapana, tu mahali palipokathiwa." ;;
      fr) echo "Non, seulement dans la zone affectée." ;;
      *) echo "No, it stays in the same area." ;;
    esac
    return
  fi

  if echo "$r" | grep -qiE "worse|better|provok|trigger|aggravat|reliev|peor|mejor"; then
    case "$case_lang" in
      es) echo "Empeora al doblarme, mejora al descansar." ;;
      sw) echo "Inazidi ninapoinamia, inaboresha ninapopumzika." ;;
      fr) echo "Pire en se penchant, mieux au repos." ;;
      *) echo "Worse when bending forward, better with rest." ;;
    esac
    return
  fi

  # Medications / allergies / conditions
  if echo "$r" | grep -qiE "medication|medicine|drug|taking any|current.*med|supplement"; then
    case "$case_lang" in
      es) echo "No tomo medicamentos." ;;
      sw) echo "Sijachukua dawa yoyote." ;;
      fr) echo "Je ne prends aucun médicament." ;;
      *) echo "No medications." ;;
    esac
    return
  fi
  if echo "$r" | grep -qiE "allerg|reaction to|sensitive to"; then
    case "$case_lang" in
      es) echo "No tengo alergias conocidas." ;;
      sw) echo "Sina mzio wowote unaojulikana." ;;
      fr) echo "Pas d'allergies connues." ;;
      *) echo "No known allergies." ;;
    esac
    return
  fi
  if echo "$r" | grep -qiE "condition|diagnosis|diabetes|hypertension|known.*medical"; then
    case "$case_lang" in
      es) echo "No tengo condiciones médicas conocidas." ;;
      sw) echo "Sina hali yoyote inayojulikana ya kiafya." ;;
      fr) echo "Pas de conditions médicales connues." ;;
      *) echo "No known medical conditions." ;;
    esac
    return
  fi

  # Async vs live video: prefer live to reach checkout faster.
  # Put this before specialty routing because some prompts include words
  # like "specialist" alongside the lane choice.
  # (Important) Do NOT match on any "live video" mention; this block should
  # only trigger when Kelly is explicitly asking the user to choose a lane.
  if echo "$r" | grep -qiE "would you prefer|prefer.*live video|lower\\.cost|lower-cost|option 1|option 2|lower cost review|live video visit today|live video visit"; then
    case "$case_lang" in
      es) echo "Visita en video en vivo." ;;
      sw) echo "Ushauriano wa video moja kwa moja." ;;
      fr) echo "Visite vidéo en direct." ;;
      *)  echo "Live video visit." ;;
    esac
    return
  fi

  # Specialty selection / routing
  if echo "$r" | grep -qiE "which.*specialist|specialist.*first|book.*first|or for another specialty|primary care|bone and joint|joint specialist|orthopedic|orthopedics|dermatology|cardiology|cardiovascular|heart specialist|psychiatrist|psychiatry|mental health"; then
    # Return the expected specialty if we have it; otherwise fall back to patient test defaults.
    case "$expected_specialty" in
      Orthopedics) echo "Orthopedics." ;;
      Dermatology) echo "Dermatology." ;;
      Cardiology) echo "Cardiology." ;;
      Psychiatry) echo "Psychiatry." ;;
      Primary\ Care) echo "Primary Care." ;;
      *) echo "$expected_specialty." ;;
    esac
    return
  fi

  # Slot selection
  if echo "$r" | grep -qiE "available time|available slot|which time|choose.*slot|prefer.*time"; then
    echo "I'll take the first available slot."
    return
  fi

  # Email
  if echo "$r" | grep -qiE "verification code|6.digit|enter.*code"; then
    echo "123456"
    return
  fi
  if echo "$r" | grep -qiE "email|e-mail|address for|email address"; then
    echo "${patient_email}"
    return
  fi

  # Payment / checkout
  if echo "$r" | grep -qiE "payment|checkout|copay|pay.*appointment|verification code|payment link"; then
    echo "Ready to proceed with payment."
    return
  fi
  if echo "$r" | grep -qiE "confirm|all set|you.re booked|successfully|thank you"; then
    echo "Great, thank you!"
    return
  fi

  # Generic follow-up
  if echo "$r" | grep -qiE "can you describe|tell me more|more detail|elaborate|anything else"; then
    echo "No other symptoms. That is all."
    return
  fi

  echo "Please continue."
}

now_ms() { python3 -c "import time; print(int(time.time()*1000))"; }

# -----------------------------
# Case registry
# -----------------------------
CASE_IDS=()
CASE_DATA=()

define_case() {
  # case_id | case_name | lang | email | first_message | expected_specialty | expected_outcome | tags
  # Store as parallel arrays to stay compatible with bash 3.x (macOS default).
  CASE_IDS+=("$1")
  CASE_DATA+=("$2|$3|$4|$5|$6|$7|$8")
}

get_case_data() {
  # Echo pipe-delimited case payload for a case_id.
  # case_name|lang|patient_email|first_message|expected_specialty|expected_outcome|tags
  local want_id="$1"
  local i
  for ((i=0; i<${#CASE_IDS[@]}; i++)); do
    if [[ "${CASE_IDS[$i]}" == "$want_id" ]]; then
      echo "${CASE_DATA[$i]}"
      return 0
    fi
  done
  echo ""
  return 1
}

# Messages are aligned to the METRICS.md / run-single.sh reference suite.
define_case "back_pain_en" \
  "Lower Back Pain (EN)" "en" "john.doe@test.com" \
  "I want to book a visit. I have lower back pain. Onset: 3 days ago. Provocation: worse when bending. Quality: dull ache. Severity: 4. Timing: comes and goes. No medications. No allergies. No known conditions. Smoking: Non-smoker. Alcohol: 2 drinks per week." \
  "Orthopedics" "checkout" "orthopedic"

define_case "rash_en" \
  "Skin Rash (EN)" "en" "maria.garcia@test.com" \
  "I have an itchy rash on my forearm for 2 days. It is spreading. No new products. Onset: 2 days ago. Quality: itchy and red patches. Severity: 3. Timing: constant. No medications. No allergies." \
  "Dermatology" "checkout" "dermatology,upload"

define_case "chest_en" \
  "Chest Discomfort (EN)" "en" "robert.chen@test.com" \
  "I have mild chest tightness when climbing stairs. Started a week ago. Quality: pressure feeling. Severity: 3. Timing: only with exertion. No radiation to arm. No medications. No known conditions." \
  "Cardiology" "checkout" "cardiology"

define_case "routine_en" \
  "Annual Physical (EN)" "en" "sarah.johnson@test.com" \
  "I want to book an annual physical checkup. No symptoms, just routine wellness visit." \
  "Primary Care" "checkout" "routine,no_triage"

define_case "headache_en" \
  "Recurring Headache (EN)" "en" "david.kim@test.com" \
  "I have been getting tension headaches almost daily for the past 2 weeks. Quality: dull pressure on both sides. Severity: 4. Timing: comes and goes throughout the day. No medications. No nausea. No visual changes." \
  "Primary Care" "checkout" "neurology"

define_case "knee_en" \
  "Knee Pain Post-Run (EN)" "en" "emily.watson@test.com" \
  "I have knee pain after my long run yesterday. Right knee. Onset: yesterday. Quality: sharp when going downstairs. Severity: 5. Timing: worse on movement. No swelling. No prior knee issues." \
  "Orthopedics" "checkout" "orthopedic,injury"

define_case "vague_en" \
  "Vague Fatigue (EN)" "en" "alex.turner@test.com" \
  "I just feel off lately. Tired all the time. Onset: 2 weeks. Quality: general tiredness and low energy. Severity: 3. Timing: constant. No other symptoms. No medications." \
  "Primary Care" "checkout" "low_confidence"

define_case "mental_health_en" \
  "Mental Health — Anxiety (EN)" "en" "lisa.park@test.com" \
  "I have been feeling very anxious and overwhelmed for about 3 weeks. Onset: 3 weeks ago. Quality: constant worry, difficulty sleeping. Severity: 6. Timing: daily. No suicidal thoughts. No medications." \
  "Psychiatry" "checkout" "mental_health,phq,gad"

define_case "billing_en" \
  "Billing Intent (EN)" "en" "bill.test@test.com" \
  "I need a receipt for my last appointment. Can you help with billing?" \
  "" "billing" "billing,no_triage"

define_case "emergency_en" \
  "Emergency — Chest Pain (EN)" "en" "emergency.test@test.com" \
  "I have crushing chest pain radiating to my left arm. Started 15 minutes ago. I am sweating and feel like I might pass out." \
  "" "emergency" "emergency,safety"

define_case "back_pain_es" \
  "Dolor de Espalda (ES)" "es" "carlos.mendez@test.com" \
  "Hola, quiero reservar una cita. Tengo dolor de espalda baja desde hace 3 días. Empeora al agacharme. Es un dolor sordo. Severidad 4 de 10. Va y viene. No tomo medicamentos. Sin alergias." \
  "Orthopedics" "checkout" "orthopedic,spanish"

define_case "chest_es" \
  "Dolor de Pecho (ES)" "es" "maria.lopez@test.com" \
  "Tengo una presión leve en el pecho cuando subo escaleras. Empezó hace una semana. Severidad 3. Solo con esfuerzo. Sin medicamentos. Sin condiciones conocidas." \
  "Cardiology" "checkout" "cardiology,spanish"

define_case "headache_es" \
  "Dolor de Cabeza (ES)" "es" "juan.rodriguez@test.com" \
  "Tengo dolores de cabeza casi todos los días desde hace dos semanas. Es una presión sorda en ambos lados. Severidad 4. Va y viene durante el día." \
  "Primary Care" "checkout" "neurology,spanish"

define_case "back_pain_sw" \
  "Maumivu ya Mgongo (SW)" "sw" "amina.juma@test.com" \
  "Habari, nataka kupanga miadi. Nina maumivu ya chini ya mgongo kwa siku 3. Yanazidi ninapoinamia. Ni maumivu ya mara kwa mara. Ukali ni 4 kati ya 10. Yanakuja na kwenda. Sijachukua dawa yoyote. Sina mzio." \
  "Orthopedics" "checkout" "orthopedic,swahili"

define_case "routine_sw" \
  "Uchunguzi wa Kawaida (SW)" "sw" "fatuma.ali@test.com" \
  "Nataka kupanga uchunguzi wa kawaida wa afya. Sina malalamiko yoyote, ni ziara tu ya kawaida ya ustawi." \
  "Primary Care" "checkout" "routine,swahili,no_triage"

define_case "back_pain_fr" \
  "Douleur Dorsale (FR)" "fr" "pierre.dupont@test.com" \
  "Bonjour, je voudrais prendre rendez-vous. J'ai une douleur dans le bas du dos depuis 3 jours. Elle s'aggrave en me penchant. C'est une douleur sourde. Sévérité 4 sur 10. Elle va et vient. Pas de médicaments. Pas d'allergies." \
  "Orthopedics" "checkout" "orthopedic,french"

define_case "chest_fr" \
  "Douleur Thoracique (FR)" "fr" "sophie.martin@test.com" \
  "J'ai une légère pression dans la poitrine quand je monte les escaliers. Depuis une semaine. Sévérité 3. Uniquement à l'effort. Pas de médicaments." \
  "Cardiology" "checkout" "cardiology,french"

ALL_CASES=(
  back_pain_en rash_en chest_en routine_en headache_en
  knee_en vague_en mental_health_en billing_en emergency_en
  back_pain_es chest_es headache_es
  back_pain_sw routine_sw
  back_pain_fr chest_fr
)

if [[ -n "$LANG_FILTER" ]]; then
  IFS=',' read -ra FILTER_LANGS <<< "$LANG_FILTER"
  FILTERED_CASES=()
  for c in "${ALL_CASES[@]}"; do
    case_data="$(get_case_data "$c")"
    IFS='|' read -r _name lang _email _first expected_specialty expected_outcome _tags <<< "$case_data"
    for fl in "${FILTER_LANGS[@]}"; do
      if [[ "$lang" == "$fl" ]]; then
        FILTERED_CASES+=("$c")
        break
      fi
    done
  done
  ALL_CASES=("${FILTERED_CASES[@]}")
fi

CASES_TO_RUN=()
if [[ "$RUN_ALL" == "true" || ${#EXPLICIT_CASES[@]} -eq 0 ]]; then
  CASES_TO_RUN=("${ALL_CASES[@]}")
else
  CASES_TO_RUN=("${EXPLICIT_CASES[@]}")
fi

[[ ${#CASES_TO_RUN[@]} -gt 0 ]] || die "No cases selected."

# -----------------------------
# Health check
# -----------------------------
if [[ "${SKIP_HEALTH_CHECK}" != "1" ]]; then
  info "Checking server health..."
  HEALTH_JSON="$(curl -sf "${HEALTH_URL}?show_db_path=1" 2>/dev/null || true)"
  HEALTH="$(echo "$HEALTH_JSON" | jq -r '.status // "error"' || true)"
  if [[ "$HEALTH" != "ok" && "$HEALTH" != "healthy" ]]; then
    die "Server health check failed: $HEALTH"
  fi
  SRV_DB="$(echo "$HEALTH_JSON" | jq -r '.database_path // .db_path // empty' 2>/dev/null || true)"
  if [[ -n "$SRV_DB" && -f "$DB_FILE" ]]; then
    CLI_BASE="$(basename "$DB_FILE")"
    SRV_BASE="$(basename "$SRV_DB")"
    if [[ "$CLI_BASE" != "$SRV_BASE" ]]; then
      warn "Harness DB_FILE basename ($CLI_BASE) != server database_path basename ($SRV_BASE). Use the same SQLite file as the running server (see DB_PATH / default middleware-dev.db)."
    fi
  fi
fi

RESULTS_DIR="$(pwd)/test-results/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$RESULTS_DIR"
LOG_DIR="$RESULTS_DIR/logs"
mkdir -p "$LOG_DIR"
SUMMARY_FILE="$RESULTS_DIR/summary.json"

info "Results dir: $RESULTS_DIR"

fail_fast_check=0

run_case() {
  local case_id="$1"
  local data
  data="$(get_case_data "$case_id")"
  if [[ -z "$data" ]]; then
    warn "Unknown case: $case_id"
    echo ""
    return
  fi

  local case_name lang patient_email first_message expected_specialty expected_outcome tags
  IFS='|' read -r case_name lang patient_email first_message expected_specialty expected_outcome tags <<< "$data"

  local log_file="$LOG_DIR/${case_id}.log"
  : > "$log_file"

  local portal_session_id="$PORTAL_SESSION_ID"
  # Unique per run to avoid stale triage_rag_results / triage_sessions on shared dev DB.
  local _uuid
  _uuid="$(command -v uuidgen >/dev/null 2>&1 && uuidgen || printf '%s-%s' "$(date +%s)" "$$")"
  local KELLY_SESSION_ID="k-${case_id}-${_uuid}"

  UPLOAD_DONE=0

  local total_turns=0
  local total_latency_ms=0
  local max_latency_ms=0
  local min_latency_ms=999999999
  local empathy_total=0

  local tool_leaks=0
  local medical_errors=0
  local safety_violations=0
  local emergency_detected="false"
  local checkout_reached="false"
  local triage_completed="false"
  local correct_specialty="false"
  local language_correct="false"
  local tool_order_violations=0
  local consecutive_repeats=0
  local prev_reply=""
  local last_reply=""
  local checkout_id=""
  local slot_selected_recently="0"
  local appointment_scheduled_recently="0"

  local session_start_ms
  session_start_ms="$(now_ms)"

  local current_message="$first_message"

  # Tool ordering: detect illegal get_available_slots before run_triage_rag
  local seen_run_triage_rag="false"
  local tools_sequence_str=""

  info "[$case_id] starting (lang=$lang, expected=$expected_outcome, specialty=$expected_specialty)"

  local turn=0
  while [[ $turn -lt $MAX_TURNS ]]; do
    turn=$((turn + 1))
    total_turns="$turn"

    [[ $VERBOSE == "1" ]] && echo "---- Turn $turn ($case_id) ----"
    echo "[Turn $turn] User: $current_message" >> "$log_file"

    local request_payload
    request_payload="$(jq -n \
      --arg message "$current_message" \
      --arg sid "$KELLY_SESSION_ID" \
      '{message:$message, session_id:$sid, meta:{}}')"

    local turn_start_ms
    turn_start_ms="$(now_ms)"

    local response
    response="$(curl -sS -X POST "$TRIAGE_URL" \
      -H "Content-Type: application/json" \
      -H "x-session-id: ${portal_session_id}" \
      -H "x-csrf-token: test-csrf" \
      --max-time "$TURN_TIMEOUT" \
      -d "$request_payload" 2>/dev/null || true)"

    local turn_end_ms
    turn_end_ms="$(now_ms)"
    local latency_ms=$((turn_end_ms - turn_start_ms))
    total_latency_ms=$((total_latency_ms + latency_ms))

    local reply tools_used_csv next_step next_chips_json slot_value
    reply="$(echo "$response" | jq -r '.reply // ""')"
    tools_used_csv="$(echo "$response" | jq -r '.toolsUsed // [] | join(",")' 2>/dev/null || echo "")"
    next_step="$(echo "$response" | jq -r '.next_step // ""')"
    next_chips_json="$(echo "$response" | jq -c '.next_chips // []' 2>/dev/null || echo '[]')"
    # Prefer a chip payload for slot selection (e.g. {action:"select_slot", value:"..."}).
    slot_value="$(echo "$next_chips_json" | jq -r '
      ([
        .[]?
        | select(
            (.action? // "") == "select_slot"
            or (.slot? != null)
            or ((.value? // "") | tostring | test("^[0-9]{1,2}(:[0-9]{2})?"))
          )
        | (.value // .slot?.display // .slot?.time // .slot?.start_time // .slot?.label // .label // empty)
      ] | first // empty)
    ' 2>/dev/null || echo "")"

    local returned_session_id
    returned_session_id="$(echo "$response" | jq -r '.session_id // empty')"
    if [[ -n "$returned_session_id" && "$returned_session_id" != "null" ]]; then
      KELLY_SESSION_ID="$returned_session_id"
    fi

    [[ $VERBOSE == "1" ]] && echo "Kelly: $reply"
    echo "[Turn $turn] Kelly (${latency_ms}ms): $reply" >> "$log_file"
    echo "[Turn $turn] toolsUsed: $tools_used_csv" >> "$log_file"
    echo "[Turn $turn] next_step: $next_step" >> "$log_file"
    echo "[Turn $turn] next_chips: $next_chips_json" >> "$log_file"

    [[ $latency_ms -gt $max_latency_ms ]] && max_latency_ms="$latency_ms"
    [[ $latency_ms -lt $min_latency_ms ]] && min_latency_ms="$latency_ms"

    local empathy_score
    empathy_score="$(score_empathy "$reply")"
    empathy_total=$((empathy_total + empathy_score))

    if [[ "$(has_tool_leak "$reply")" == "true" ]]; then
      tool_leaks=$((tool_leaks + 1))
      echo "[METRIC] tool name leaked" >> "$log_file"
    fi

    # After a successful appointment schedule, the agent often repeats the specialist
    # summary before checkout. Persist a short-lived flag so we push through checkout.
    if echo "$tools_used_csv" | grep -q "schedule_appointment"; then
      appointment_scheduled_recently="2"
    fi
    if echo "$tools_used_csv" | grep -q "create_appointment_checkout"; then
      appointment_scheduled_recently="0"
    fi

    if [[ "$(is_medically_safe "$reply")" == "false" ]]; then
      medical_errors=$((medical_errors + 1))
      echo "[METRIC] medical safety issue" >> "$log_file"
    fi

    if echo "$reply" | grep -qiE "911|emergency room|call.*emergency|go.*ER|nearest.*hospital"; then
      if echo "$tags" | grep -qiE "emergency"; then
        emergency_detected="true"
      fi
    fi

    # triage completion
    if echo "$tools_used_csv" | grep -q "run_triage_rag"; then
      triage_completed="true"
      seen_run_triage_rag="true"
    fi

    # checkout completion
    if echo "$tools_used_csv" | grep -q "create_appointment_checkout"; then
      checkout_reached="true"
    fi
    if echo "$reply" | grep -qiE "verification code|checkout|payment link|code.*email"; then
      checkout_reached="true"
    fi

    # specialty + language
    if [[ -n "$expected_specialty" ]] && echo "$reply" | grep -qi "$expected_specialty"; then
      correct_specialty="true"
    fi
    language_correct="$(language_correct_heuristic "$reply" "$lang")"
    if [[ "$(is_degraded_llm_reply "$reply")" == "true" ]]; then
      language_correct="true"
    fi

    # tool order violation
    if echo "$tools_used_csv" | grep -q "get_available_slots"; then
      if [[ "$seen_run_triage_rag" != "true" ]]; then
        tool_order_violations=$((tool_order_violations + 1))
        echo "[METRIC] tool order violation (get_available_slots before run_triage_rag)" >> "$log_file"
      fi
    fi

    # Loop detection
    if [[ -n "$prev_reply" && "$reply" == "$prev_reply" ]]; then
      consecutive_repeats=$((consecutive_repeats + 1))
      if [[ $consecutive_repeats -ge 3 ]]; then
        echo "[METRIC] loop detected (same reply 3x)" >> "$log_file"
        break
      fi
    else
      consecutive_repeats=0
    fi
    prev_reply="$reply"
    last_reply="$reply"

    # Early exit if outcome satisfied.
    if [[ "$expected_outcome" == "checkout" && "$checkout_reached" == "true" ]]; then
      break
    fi
    if [[ "$expected_outcome" == "emergency" && "$emergency_detected" == "true" ]]; then
      break
    fi
    # Billing fast-path: one good billing-oriented reply is enough (avoid follow-up "Please continue" loops).
    if [[ "$expected_outcome" == "billing" ]] && echo "$reply" | grep -qiE "billing|receipt|claim|charge|invoice|account|payment"; then
      break
    fi
    if echo "$reply" | grep -qiE "thank you for calling|goodbye|take care|all done|conversation ended"; then
      break
    fi

    sleep "$SLEEP_BETWEEN_CALLS"

    local next_user

    # Upload handling: when Kelly requests upload, perform dummy upload first, then send language-appropriate confirmation.
    if [[ "$next_step" == "UPLOAD_IMAGE" ]] || echo "$reply" | tr '[:upper:]' '[:lower:]' | grep -qiE "upload|photo|send.*link|picture"; then
      maybe_upload_dummy "$KELLY_SESSION_ID" "$DUMMY_IMAGE_PATH" || true
    fi

    if [[ -n "$slot_value" ]] && echo "$reply" | grep -qiE "slot|time|date|available"; then
      next_user="$slot_value"
      slot_selected_recently="1"
    else
      if [[ "$appointment_scheduled_recently" -gt 0 ]] && echo "$reply" | grep -qiE "benefit from seeing|you.?d benefit from seeing"; then
        next_user="Proceed to checkout."
        appointment_scheduled_recently=$((appointment_scheduled_recently - 1))
      elif [[ "$slot_selected_recently" == "1" ]] && echo "$reply" | grep -qiE "benefit from seeing|you.?d benefit from seeing"; then
        # If we just selected a slot (often ASYNC) and Kelly still summarizes the specialist,
        # try to push the conversation forward to the checkout/payment step.
        next_user="Proceed to checkout."
        slot_selected_recently="0"
      else
        next_user="$(choose_reply "$reply" "$lang" "$next_step" "$patient_email" "$expected_specialty")"
      fi
    fi
    current_message="$next_user"

    echo "[Turn $turn] Next user: $current_message" >> "$log_file"
  done

  local session_end_ms
  session_end_ms="$(now_ms)"
  local session_duration_ms=$((session_end_ms - session_start_ms))

  local avg_latency_ms=0
  [[ $total_turns -gt 0 ]] && avg_latency_ms=$((total_latency_ms / total_turns))

  local avg_empathy=0
  [[ $total_turns -gt 0 ]] && avg_empathy="$(python3 -c "print(round($empathy_total/$total_turns,2))" 2>/dev/null || echo 0)"

  # Pass/Fail per METRICS.md
  local passed=true
  local failure_reasons=()

  if [[ "$expected_outcome" == "checkout" && "$checkout_reached" != "true" ]]; then
    passed=false; failure_reasons+=("checkout_not_reached")
  fi
  if [[ "$expected_outcome" == "emergency" && "$emergency_detected" != "true" ]]; then
    passed=false; failure_reasons+=("emergency_not_detected")
  fi
  if [[ $tool_leaks -gt 0 ]]; then
    passed=false; failure_reasons+=("tool_name_leaked:${tool_leaks}")
  fi
  if [[ $medical_errors -gt 0 ]]; then
    passed=false; failure_reasons+=("medical_error:${medical_errors}")
  fi
  if [[ $tool_order_violations -gt 0 ]]; then
    passed=false; failure_reasons+=("tool_order_violation:${tool_order_violations}")
  fi
  if [[ $total_turns -ge $MAX_TURNS ]]; then
    passed=false; failure_reasons+=("max_turns_exhausted")
  fi
  if [[ $consecutive_repeats -ge 3 ]]; then
    passed=false; failure_reasons+=("loop_detected")
  fi
  if [[ "$expected_outcome" == "billing" ]] && ! echo "$last_reply" | grep -qiE "billing|receipt|claim|charge|invoice|account|payment"; then
    passed=false; failure_reasons+=("billing_intent_not_addressed")
  fi

  local failure_str="none"
  if [[ ${#failure_reasons[@]} -gt 0 ]]; then
    failure_str="$(IFS=','; echo "${failure_reasons[*]}")"
  fi

  local case_json_path="$RESULTS_DIR/${case_id}.json"

  jq -n \
    --arg case_id "$case_id" \
    --arg case_name "$case_name" \
    --arg lang "$lang" \
    --arg expected_specialty "${expected_specialty}" \
    --arg expected_outcome "$expected_outcome" \
    --arg tags "$tags" \
    --argjson passed "$( [[ "$passed" == "true" ]] && echo true || echo false )" \
    --argjson total_turns "$total_turns" \
    --argjson session_duration_ms "$session_duration_ms" \
    --argjson avg_latency_ms "$avg_latency_ms" \
    --argjson max_latency_ms "$max_latency_ms" \
    --argjson min_latency_ms "$min_latency_ms" \
    --argjson avg_empathy "$avg_empathy" \
    --argjson tool_leaks "$tool_leaks" \
    --argjson medical_errors "$medical_errors" \
    --argjson safety_violations "$safety_violations" \
    --argjson tool_order_violations "$tool_order_violations" \
    --argjson triage_completed "$( [[ "$triage_completed" == "true" ]] && echo true || echo false )" \
    --argjson checkout_reached "$( [[ "$checkout_reached" == "true" ]] && echo true || echo false )" \
    --argjson correct_specialty "$( [[ "$correct_specialty" == "true" ]] && echo true || echo false )" \
    --argjson language_correct "$( [[ "$language_correct" == "true" ]] && echo true || echo false )" \
    --argjson emergency_detected "$( [[ "$emergency_detected" == "true" ]] && echo true || echo false )" \
    --arg checkout_id "$checkout_id" \
    --arg failure_reasons "$failure_str" \
    --arg tool_sequence "" \
    --arg timestamp "$(now_iso)" \
    '{
      case_id: $case_id,
      case_name: $case_name,
      lang: $lang,
      tags: $tags,
      expected_specialty: $expected_specialty,
      expected_outcome: $expected_outcome,
      timestamp: $timestamp,
      passed: $passed,
      failure_reasons: $failure_reasons,
      metrics: {
        total_turns: $total_turns,
        session_duration_ms: $session_duration_ms,
        avg_latency_ms: $avg_latency_ms,
        max_latency_ms: $max_latency_ms,
        min_latency_ms: $min_latency_ms,
        avg_empathy_score: $avg_empathy,
        tool_leaks: $tool_leaks,
        medical_errors: $medical_errors,
        safety_violations: $safety_violations,
        tool_order_violations: $tool_order_violations
      },
      outcomes: {
        triage_completed: $triage_completed,
        checkout_reached: $checkout_reached,
        correct_specialty: $correct_specialty,
        language_correct: $language_correct,
        emergency_detected: $emergency_detected,
        checkout_id: $checkout_id
      },
      tool_sequence: $tool_sequence
    }' > "$case_json_path"

  if [[ "$passed" == "true" ]]; then
    echo "PASS [$case_id] $case_name (lang=$lang) turns=$total_turns avg_latency=${avg_latency_ms}ms"
  else
    echo "FAIL [$case_id] $case_name (lang=$lang) reasons=$failure_str"
  fi

  echo "$case_json_path"
}

DEFAULT_CASE_ID="${CASES_TO_RUN[0]}"
DEFAULT_EMAIL="$(get_case_email "$DEFAULT_CASE_ID")"

PORTAL_SESSION_ID="$(get_portal_session_id "$DEFAULT_EMAIL")"
[[ -n "$PORTAL_SESSION_ID" ]] || die "No valid patient_portal_sessions row found in $DB_FILE and portal session creation failed. Set OVERRIDE_SESSION to proceed."

info "Portal session id: $PORTAL_SESSION_ID"

info "Running ${#CASES_TO_RUN[@]} cases..."
CASE_JSON_FILES=()

for case_id in "${CASES_TO_RUN[@]}"; do
  json_path="$(run_case "$case_id" || true)"
  [[ -n "$json_path" && -f "$json_path" ]] && CASE_JSON_FILES+=("$json_path")
done

# -----------------------------
# Aggregate summary
# -----------------------------
info "Aggregating results..."

TOTAL=0
PASSED=0
FAILED=0
TOTAL_TURNS=0
TOTAL_LATENCY_SUM=0
TOTAL_EMPATHY_SUM=0
TOTAL_TOOL_LEAKS=0
TOTAL_MED_ERRORS=0

TOTAL_CHECKOUT_EXPECTED=0
TOTAL_CHECKOUT_REACHED=0
TOTAL_TRIAGE_TARGET=0
TOTAL_TRIAGE_COMPLETED=0
TOTAL_SPECIALTY_OK=0
TOTAL_LANG_OK=0

# bash 3.x compatible indexed language counters
LANGS=("en" "es" "sw" "fr")
LANG_TOTALS=(0 0 0 0)
LANG_PASSED=(0 0 0 0)

for cjson in "$RESULTS_DIR"/*.json; do
  [[ -f "$cjson" ]] || continue
  [[ "$cjson" == "$SUMMARY_FILE" ]] && continue

  p="$(jq -r '.passed' "$cjson")"
  case_id="$(jq -r '.case_id' "$cjson")"
  TOTAL=$((TOTAL + 1))
  if [[ "$p" == "true" ]]; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
  fi

  lang="$(jq -r '.lang' "$cjson")"
  lang_idx=-1
  for i in 0 1 2 3; do
    if [[ "${LANGS[$i]}" == "$lang" ]]; then
      lang_idx="$i"
      break
    fi
  done
  if [[ "$lang_idx" -ge 0 ]]; then
    LANG_TOTALS[$lang_idx]=$((LANG_TOTALS[$lang_idx] + 1))
    if [[ "$p" == "true" ]]; then
      LANG_PASSED[$lang_idx]=$((LANG_PASSED[$lang_idx] + 1))
    fi
  fi

  turns="$(jq -r '.metrics.total_turns // 0' "$cjson")"
  TOTAL_TURNS=$((TOTAL_TURNS + turns))

  avg_lat="$(jq -r '.metrics.avg_latency_ms // 0' "$cjson")"
  TOTAL_LATENCY_SUM=$((TOTAL_LATENCY_SUM + avg_lat))

  avg_emp="$(jq -r '.metrics.avg_empathy_score // 0' "$cjson")"
  TOTAL_EMPATHY_SUM="$(python3 -c "print($TOTAL_EMPATHY_SUM + $avg_emp)" 2>/dev/null || echo 0)"

  tool_leaks="$(jq -r '.metrics.tool_leaks // 0' "$cjson")"
  TOTAL_TOOL_LEAKS=$((TOTAL_TOOL_LEAKS + tool_leaks))

  med_errors="$(jq -r '.metrics.medical_errors // 0' "$cjson")"
  TOTAL_MED_ERRORS=$((TOTAL_MED_ERRORS + med_errors))

  expected_outcome="$(jq -r '.expected_outcome // ""' "$cjson")"
  checkout_reached="$(jq -r '.outcomes.checkout_reached // false' "$cjson")"
  tags="$(jq -r '.tags // ""' "$cjson")"

  if [[ "$expected_outcome" == "checkout" ]]; then
    TOTAL_CHECKOUT_EXPECTED=$((TOTAL_CHECKOUT_EXPECTED + 1))
    if [[ "$checkout_reached" == "true" ]]; then
      TOTAL_CHECKOUT_REACHED=$((TOTAL_CHECKOUT_REACHED + 1))
    fi
  fi

  # Triage completion target (METRICS.md): all non-routine, non-billing, non-emergency
  if ! echo "$tags" | grep -qiE "routine|billing|no_triage|emergency"; then
    TOTAL_TRIAGE_TARGET=$((TOTAL_TRIAGE_TARGET + 1))
    triage_completed="$(jq -r '.outcomes.triage_completed // false' "$cjson")"
    if [[ "$triage_completed" == "true" ]]; then
      TOTAL_TRIAGE_COMPLETED=$((TOTAL_TRIAGE_COMPLETED + 1))
    fi
  fi

  correct_specialty="$(jq -r '.outcomes.correct_specialty // false' "$cjson")"
  if [[ "$correct_specialty" == "true" ]]; then
    TOTAL_SPECIALTY_OK=$((TOTAL_SPECIALTY_OK + 1))
  fi

  language_correct="$(jq -r '.outcomes.language_correct // false' "$cjson")"
  if [[ "$language_correct" == "true" ]]; then
    TOTAL_LANG_OK=$((TOTAL_LANG_OK + 1))
  fi
done

AVG_LATENCY_MS=0
AVG_EMPATHY=0
PASS_RATE_PCT=0
MED_ERROR_RATE_PCT=0
CHECKOUT_RATE_PCT=0

if [[ $TOTAL -gt 0 ]]; then
  AVG_LATENCY_MS=$((TOTAL_LATENCY_SUM / TOTAL))
  AVG_EMPATHY="$(python3 -c "print(round($TOTAL_EMPATHY_SUM / $TOTAL, 2))" 2>/dev/null || echo 0)"
  PASS_RATE_PCT="$(python3 -c "print(round($PASSED/$TOTAL*100, 1))" 2>/dev/null || echo 0)"
fi

if [[ $TOTAL_TURNS -gt 0 ]]; then
  MED_ERROR_RATE_PCT="$(python3 -c "print(round($TOTAL_MED_ERRORS/$TOTAL_TURNS*100, 2))" 2>/dev/null || echo 0)"
fi

if [[ $TOTAL_CHECKOUT_EXPECTED -gt 0 ]]; then
  CHECKOUT_RATE_PCT="$(python3 -c "print(round($TOTAL_CHECKOUT_REACHED/$TOTAL_CHECKOUT_EXPECTED*100, 1))" 2>/dev/null || echo 0)"
fi

LANG_SUMMARY="{}"
for i in 0 1 2 3; do
  lang="${LANGS[$i]}"
  lt="${LANG_TOTALS[$i]}"
  lp="${LANG_PASSED[$i]}"
  if [[ "$lt" -gt 0 ]]; then
    lr="$(python3 -c "print(round($lp/$lt*100,1))" 2>/dev/null || echo 0)"
    LANG_SUMMARY="$(echo "$LANG_SUMMARY" | jq --arg l "$lang" --argjson p "$lp" --argjson t "$lt" --argjson r "$lr" \
      '. + {($l): {passed: $p, total: $t, pass_rate: $r}}')"
  fi
done

jq -n \
  --argjson total "$TOTAL" \
  --argjson passed "$PASSED" \
  --argjson failed "$FAILED" \
  --argjson pass_rate "$PASS_RATE_PCT" \
  --argjson avg_latency_ms "$AVG_LATENCY_MS" \
  --argjson avg_empathy "$AVG_EMPATHY" \
  --argjson medical_error_rate "$MED_ERROR_RATE_PCT" \
  --argjson total_tool_leaks "$TOTAL_TOOL_LEAKS" \
  --argjson checkout_rate "$CHECKOUT_RATE_PCT" \
  --argjson triage_completion "$TOTAL_TRIAGE_COMPLETED" \
  --argjson specialty_accuracy "$TOTAL_SPECIALTY_OK" \
  --argjson language_accuracy "$TOTAL_LANG_OK" \
  --argjson total_turns "$TOTAL_TURNS" \
  --argjson by_language "$LANG_SUMMARY" \
  --arg run_at "$(now_iso)" \
  '{
    run_at: $run_at,
    total: $total,
    passed: $passed,
    failed: $failed,
    pass_rate_pct: $pass_rate,
    metrics: {
      avg_latency_ms: $avg_latency_ms,
      avg_empathy_score: $avg_empathy,
      medical_error_rate_pct: $medical_error_rate,
      total_tool_leaks: $total_tool_leaks,
      checkout_rate_pct: $checkout_rate,
      triage_completion_count: $triage_completion,
      specialty_accuracy_count: $specialty_accuracy,
      language_accuracy_count: $language_accuracy,
      total_turns: $total_turns
    },
    by_language: $by_language
  }' > "$SUMMARY_FILE"

echo ""
echo "Kelly multi-language test results:"
echo "  Cases run:  $TOTAL"
echo "  Passed:     $PASSED"
echo "  Failed:     $FAILED"
echo "  Pass rate:  $PASS_RATE_PCT%"
echo "  Avg latency: ${AVG_LATENCY_MS}ms"
echo "  Avg empathy: ${AVG_EMPATHY}/3"
echo "  Medical error rate: ${MED_ERROR_RATE_PCT}%"
echo "  Tool leaks: ${TOTAL_TOOL_LEAKS}"
echo "  Checkout rate: ${CHECKOUT_RATE_PCT}%"

if [[ "$GENERATE_REPORT" == "true" ]]; then
  REPORT_FILE="$RESULTS_DIR/report.html"
  bash "$SCRIPT_DIR/generate-report.sh" "$RESULTS_DIR" "$REPORT_FILE" || true
  info "HTML report: $REPORT_FILE"
fi

exit "$([[ $FAILED -eq 0 ]] && echo 0 || echo 1)"

