#!/usr/bin/env bash
# Smoke checks for voice triage parity (requires server on PORT, default 4000).
# Usage: ./scripts/test-voice-triage-parity-smoke.sh
# Set BASE_URL=http://localhost:4000 CLINIC_ID=your-clinic-id for real runs.

set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:4000}"
PORT="${PORT:-4000}"
CLINIC_ID="${CLINIC_ID:-${DEFAULT_CLINIC_ID:-}}"

echo "Voice triage parity smoke — $BASE_URL"
echo "1) schedule without session_id (expect 200 or 403 from validation, not hang if REQUIRE_TRIAGE_FOR_VOICE=0)"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/voice/appointments/schedule" \
  -H "Content-Type: application/json" \
  -d "{\"clinic_id\":\"$CLINIC_ID\",\"patient_name\":\"Test\",\"patient_phone\":\"+15555550100\",\"patient_email\":\"t@example.com\",\"date\":\"2099-01-01\",\"time\":\"10:00\"}" || true)
echo "   HTTP $code (403 expected if triage enforced when session id present)"

echo "2) schedule with fake session_id (no triage row) — expect 403 TRIAGE_INCOMPLETE if clinic_id valid"
curl -s -X POST "$BASE_URL/voice/appointments/schedule" \
  -H "Content-Type: application/json" \
  -d "{\"clinic_id\":\"$CLINIC_ID\",\"session_id\":\"nonexistent-session-00000000\",\"patient_name\":\"Test\",\"patient_phone\":\"+15555550100\",\"patient_email\":\"t@example.com\",\"date\":\"2099-01-01\",\"time\":\"10:00\"}" | head -c 400
echo ""

echo "Done. Set CLINIC_ID and DEFAULT_CLINIC_ID in .env for meaningful results."
