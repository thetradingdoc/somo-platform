#!/usr/bin/env bash
# Run ICD/CPT/HCPCS embeddings until complete — detached from terminal.
#
# Survives: closing Cursor/terminal, logging out (with nohup).
# Does NOT survive: full shutdown, battery dead, or sleep (unless caffeinate + power).
#
# Usage (from middleware-platform/):
#   ./scripts/run-embeddings-daemon.sh start
#   ./scripts/run-embeddings-daemon.sh status
#   ./scripts/run-embeddings-daemon.sh stop
#   ./scripts/run-embeddings-daemon.sh logs
#
# For sleep-resistant runs on macOS, keep laptop plugged in or disable sleep in
# System Settings → Battery. For true "laptop off" completion, run on a remote host.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PID_FILE="$ROOT/tmp/embeddings-daemon.pid"
LOG_FILE="$ROOT/tmp/embeddings-daemon.log"
TARGET_TOTAL=84565

mkdir -p "$ROOT/tmp"

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null)" || return 1
  kill -0 "$pid" 2>/dev/null
}

embed_count() {
  sqlite3 -cmd ".timeout 5000" "$ROOT/middleware-dev.db" \
    "SELECT COUNT(*) FROM code_embeddings;" 2>/dev/null || echo "?"
}

cmd_start() {
  if is_running; then
    echo "Embeddings daemon already running (PID $(cat "$PID_FILE")). Log: $LOG_FILE"
    exit 0
  fi
  pkill -f "populate-code-embeddings.js --until-done" 2>/dev/null || true
  pkill -f "caffeinate -i node.*populate-code-embeddings" 2>/dev/null || true
  sleep 3
  pgrep -f "populate-code-embeddings.js --until-done" 2>/dev/null && sleep 2 || true

  export SKIP_STARTUP_MIGRATIONS=1
  export EMBED_API_CHUNK="${EMBED_API_CHUNK:-128}"

  {
    echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) embeddings daemon start ====="
    echo "cwd=$ROOT EMBED_API_CHUNK=$EMBED_API_CHUNK"
  } >>"$LOG_FILE"

  # caffeinate -i: block system idle sleep while this job runs (lid closed may still sleep)
  nohup bash -c "exec caffeinate -i node \"$ROOT/scripts/populate-code-embeddings.js\" --until-done --batch-size 5000" \
    >>"$LOG_FILE" 2>&1 &
  local wrapper_pid=$!
  disown 2>/dev/null || true
  sleep 2
  local node_pid
  node_pid="$(pgrep -f "populate-code-embeddings.js --until-done" | head -1 || true)"
  if [[ -n "$node_pid" ]]; then
    echo "$node_pid" >"$PID_FILE"
  else
    echo "$wrapper_pid" >"$PID_FILE"
  fi
  echo "Started embeddings daemon PID $(cat "$PID_FILE") (wrapper=$wrapper_pid)"
  echo "Log: $LOG_FILE"
  echo "Status: ./scripts/run-embeddings-daemon.sh status"
}

cmd_status() {
  local count
  count="$(embed_count)"
  if is_running; then
    echo "RUNNING pid=$(cat "$PID_FILE") embeddings=$count / $TARGET_TOTAL"
    tail -5 "$LOG_FILE" 2>/dev/null | sed 's/^/  /'
  else
    echo "NOT RUNNING embeddings=$count / $TARGET_TOTAL"
    if [[ -f "$PID_FILE" ]]; then
      echo "(stale pid file removed)"
      rm -f "$PID_FILE"
    fi
    if [[ "$count" == "$TARGET_TOTAL" ]] || [[ "${count:-0}" -ge "$TARGET_TOTAL" ]]; then
      echo "Target reached — ingestion complete."
    fi
  fi
}

cmd_stop() {
  if is_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    pkill -f "populate-code-embeddings.js --until-done" 2>/dev/null || true
    echo "Stopped embeddings daemon."
  else
    echo "No daemon running."
  fi
  rm -f "$PID_FILE"
}

cmd_logs() {
  tail -f "$LOG_FILE"
}

case "${1:-start}" in
  start) cmd_start ;;
  status) cmd_status ;;
  stop) cmd_stop ;;
  logs) cmd_logs ;;
  *)
    echo "Usage: $0 {start|status|stop|logs}"
    exit 1
    ;;
esac
