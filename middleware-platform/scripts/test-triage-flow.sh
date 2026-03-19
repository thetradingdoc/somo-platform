#!/bin/bash
# Test triage flow for Swahili and skip-triage intents
# Usage: ./scripts/test-triage-flow.sh [SESSION_ID]
# Get SESSION_ID: sqlite3 middleware-dev.db "SELECT id FROM patient_portal_sessions WHERE verified = 1 AND revoked_at IS NULL LIMIT 1;"

set -e
cd "$(dirname "$0")/.."
SESSION_ID="${1:-}"
if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(sqlite3 middleware-dev.db "SELECT id FROM patient_portal_sessions WHERE verified = 1 AND revoked_at IS NULL ORDER BY verified_at DESC LIMIT 1;" 2>/dev/null || true)
fi
if [ -z "$SESSION_ID" ]; then
  echo "No valid session. Get one: sqlite3 middleware-dev.db \"SELECT id FROM patient_portal_sessions WHERE verified = 1 AND revoked_at IS NULL LIMIT 1;\""
  exit 1
fi
echo "Using session: $SESSION_ID"
echo ""
echo "1. Language preference (Tunaweza ongea swahili):"
curl -s -X POST http://localhost:4000/api/patient/triage/message \
  -H "Content-Type: application/json" \
  -H "x-session-id: $SESSION_ID" \
  -d '{"message":"Tunaweza ongea swahili","state":{},"meta":{}}' | jq -r '"reply: " + .reply, "step: " + (.state.step // "none")'
echo ""
echo "2. Skip to booking (Nataka kuongea na daktari):"
curl -s -X POST http://localhost:4000/api/patient/triage/message \
  -H "Content-Type: application/json" \
  -H "x-session-id: $SESSION_ID" \
  -d '{"message":"Nataka kuongea na daktari","state":{},"meta":{}}' | jq -r '"reply: " + .reply, "step: " + (.state.step // "none")'
