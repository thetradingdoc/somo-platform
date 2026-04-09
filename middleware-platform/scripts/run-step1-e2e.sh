#!/usr/bin/env bash
set -u

# Single-command Step 1 E2E runner:
# - Starts middleware server
# - Runs Playwright Step 1 conversation test
# - Stops server cleanly
# - Prints server logs if test fails

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 1

mkdir -p tmp
SERVER_LOG="${SERVER_LOG:-/tmp/kelly-e2e-server.log}"
DB_PATH_VALUE="${DB_PATH:-./tmp/ci-test.db}"
CLINIC_ID_VALUE="${DEFAULT_CLINIC_ID:-}"
WAIT_SECS="${WAIT_SECS:-5}"
PLAYWRIGHT_TIMEOUT_MS="${PLAYWRIGHT_TIMEOUT_MS:-120000}"
BOOT_TIMEOUT_SECS="${BOOT_TIMEOUT_SECS:-25}"
STEP1_SPEC="${STEP1_SPEC:-e2e/step1-try-now-chat.spec.cjs}"

if [[ -z "$CLINIC_ID_VALUE" ]]; then
  echo "ERROR: DEFAULT_CLINIC_ID is required."
  echo "Usage:"
  echo "  DEFAULT_CLINIC_ID=<clinic-id> ./scripts/run-step1-e2e.sh"
  exit 2
fi

export DEFAULT_CLINIC_ID="$CLINIC_ID_VALUE"
export DB_PATH="$DB_PATH_VALUE"

echo "Ensuring port 4000 is free..."
lsof -ti:4000 | xargs kill -9 >/dev/null 2>&1 || true

echo "Starting middleware server..."
DB_PATH="$DB_PATH_VALUE" DEFAULT_CLINIC_ID="$CLINIC_ID_VALUE" npm start >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

sleep "$WAIT_SECS"

echo "Waiting for middleware health..."
BOOT_DEADLINE=$((SECONDS + BOOT_TIMEOUT_SECS))
until curl -fsS "http://127.0.0.1:4000/health" >/dev/null 2>&1; do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo "Server exited before health check passed."
    echo "---- Last 120 lines of server log: $SERVER_LOG ----"
    tail -n 120 "$SERVER_LOG" || true
    exit 1
  fi
  if (( SECONDS >= BOOT_DEADLINE )); then
    echo "Server did not become healthy within ${BOOT_TIMEOUT_SECS}s."
    echo "---- Last 120 lines of server log: $SERVER_LOG ----"
    tail -n 120 "$SERVER_LOG" || true
    exit 1
  fi
  sleep 1
done

echo "Running Playwright Step1 E2E..."
npx playwright test "$STEP1_SPEC" --reporter=list --timeout="$PLAYWRIGHT_TIMEOUT_MS"
TEST_EXIT=$?

echo "Playwright exit code: $TEST_EXIT"
if [[ "$TEST_EXIT" -ne 0 ]]; then
  echo "---- Last 120 lines of server log: $SERVER_LOG ----"
  tail -n 120 "$SERVER_LOG" || true
fi

exit "$TEST_EXIT"
