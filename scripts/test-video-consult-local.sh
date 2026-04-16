#!/bin/bash
# Local test script for video consult
# Uses project-local DB so writes succeed (avoids SQLITE_READONLY in sandbox/home)
# Run from project root: ./scripts/test-video-consult-local.sh

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "📋 Video Consult – Local Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Use writable DB in project (avoids readonly errors)
# Must be relative to cwd when test runs (middleware-platform)
export DB_PATH="./video-consult-test.db"
export NODE_ENV=development

echo "  DB: $DB_PATH"
echo ""

# 1. Unit tests (state reducers, E2E flow)
echo "1. Running unit tests..."
cd middleware-platform
node tests/video-consult-state.test.js
cd "$ROOT"
echo ""

# 2. E2E with curl (optional – requires server running)
echo "2. E2E via API (start server first: ./scripts/root/start-local.sh)"
echo "   In another terminal:"
echo "   curl -X POST http://localhost:4000/api/video-consult/agent-events \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"room\":\"appt-test-1\",\"event\":\"transcript\",\"payload\":{\"text\":\"Patient has a rash\",\"speaker\":\"patient\"}}'"
echo ""
echo "   Then end session:"
echo "   curl -X POST http://localhost:4000/api/video-consult/agent-events \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"room\":\"appt-test-1\",\"event\":\"end_session\",\"payload\":{\"end\":true}}'"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Done. See docs/architecture/VIDEO_CONSULT_RUNBOOK.md for details."
