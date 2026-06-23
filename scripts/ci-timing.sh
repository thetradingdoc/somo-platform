#!/usr/bin/env bash
# Run ci-local with per-step duration reporting.
# Usage: ./scripts/ci-timing.sh [fast|gate|slow|full]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIER="${1:-fast}"
LOG="${CI_TIMING_LOG:-/tmp/ci-timing-$(date +%Y%m%d%H%M%S).log}"

echo "CI timing log: $LOG"
CI_TIMING=1 bash "$ROOT/scripts/ci-local.sh" "$TIER" 2>&1 | tee "$LOG"
EXIT=${PIPESTATUS[0]}

TOTAL_START=$(grep -m1 '^==>' "$LOG" | head -1 || true)
echo ""
echo "==> Timing summary ($TIER)"
awk '
  /^==> / {
    if (step != "") {
      printf "  %s: %ds\n", step, NR - start_line
    }
    step = substr($0, 5)
    start_line = NR
  }
  END {
    if (step != "") printf "  %s: (see log)\n", step
  }
' "$LOG" 2>/dev/null || true

exit "$EXIT"
