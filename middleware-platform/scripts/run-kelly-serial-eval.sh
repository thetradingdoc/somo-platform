#!/usr/bin/env bash
# Run Kelly cases one at a time; continue on failure; write kelly-serial-eval-*.txt
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

CASES=(
  back_pain_en rash_en chest_en routine_en headache_en knee_en vague_en mental_health_en billing_en emergency_en
  back_pain_es chest_es headache_es back_pain_sw routine_sw back_pain_fr chest_fr
)

REPORT="test-results/kelly-serial-eval-$(date +%Y%m%d_%H%M%S).txt"
mkdir -p test-results

{
  echo "Kelly serial eval $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Cases: ${#CASES[@]}"
  echo ""
} | tee "$REPORT"

for c in "${CASES[@]}"; do
  echo "" | tee -a "$REPORT"
  echo "============================== CASE: $c ==============================" | tee -a "$REPORT"
  OUT="$(mktemp)"
  set +e
  bash scripts/run-kelly-tests.sh "$c" >"$OUT" 2>&1
  ec=$?
  set -e
  tail -15 "$OUT" | tee -a "$REPORT"
  RD="$(grep '\[INFO\] Results dir:' "$OUT" | tail -1 | sed 's/^\[INFO\] Results dir: //')"
  echo "exit_code=$ec  results_dir=$RD" | tee -a "$REPORT"
  if [[ -n "$RD" && -f "$RD/${c}.json" ]]; then
    jq -c '{case_id, passed, failure_reasons, outcomes, metrics: {total_turns: .metrics.total_turns, tool_order_violations: .metrics.tool_order_violations}}' "$RD/${c}.json" | tee -a "$REPORT"
    # First 12 log lines for quick scan
    if [[ -f "$RD/logs/${c}.log" ]]; then
      echo "--- log head ---" | tee -a "$REPORT"
      head -12 "$RD/logs/${c}.log" | tee -a "$REPORT"
    fi
  else
    echo "(missing ${c}.json)" | tee -a "$REPORT"
  fi
  rm -f "$OUT"
done

echo "" | tee -a "$REPORT"
echo "Wrote: $REPORT" | tee -a "$REPORT"
