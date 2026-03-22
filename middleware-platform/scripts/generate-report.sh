#!/usr/bin/env bash
# ============================================================
# Kelly Test — HTML Report Generator
# Usage: bash generate-report.sh <results_dir> <output.html>
# ============================================================
set -euo pipefail

RESULTS_DIR="${1:-.}"
OUTPUT="${2:-$RESULTS_DIR/report.html}"

SUMMARY="$RESULTS_DIR/summary.json"
[[ -f "$SUMMARY" ]] || { echo "No summary.json found in $RESULTS_DIR"; exit 1; }

# ── Gather case results ───────────────────────────────────────
CASES_JSON="["
FIRST=true
for f in "$RESULTS_DIR"/*.json; do
  [[ "$f" == "$SUMMARY" ]] && continue
  [[ -f "$f" ]] || continue
  $FIRST || CASES_JSON+=","
  CASES_JSON+=$(cat "$f")
  FIRST=false
done
CASES_JSON+="]"

# ── Read summary ──────────────────────────────────────────────
TOTAL=$(jq '.total' "$SUMMARY")
PASSED=$(jq '.passed' "$SUMMARY")
FAILED=$(jq '.failed' "$SUMMARY")
PASS_RATE=$(jq '.pass_rate_pct' "$SUMMARY")
AVG_LATENCY=$(jq '.metrics.avg_latency_ms' "$SUMMARY")
AVG_EMPATHY=$(jq '.metrics.avg_empathy_score' "$SUMMARY")
MED_ERROR=$(jq '.metrics.medical_error_rate_pct' "$SUMMARY")
TOOL_LEAKS=$(jq '.metrics.total_tool_leaks' "$SUMMARY")
CHECKOUT_RATE=$(jq '.metrics.checkout_rate_pct' "$SUMMARY")
RUN_AT=$(jq -r '.run_at' "$SUMMARY")
BY_LANG=$(jq -c '.by_language' "$SUMMARY")

# ── Generate HTML ─────────────────────────────────────────────
cat > "$OUTPUT" << HTMLEOF
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Kelly Agent Test Report — ${RUN_AT}</title>
<style>
  :root {
    --green: #10b981; --red: #ef4444; --yellow: #f59e0b;
    --blue: #3b82f6; --purple: #8b5cf6; --gray: #6b7280;
    --bg: #0f172a; --card: #1e293b; --border: #334155;
    --text: #f1f5f9; --muted: #94a3b8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; padding: 2rem; }
  h1 { font-size: 1.6rem; font-weight: 700; margin-bottom: 0.25rem; }
  .subtitle { color: var(--muted); font-size: 0.9rem; margin-bottom: 2rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .metric-card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 0.75rem; padding: 1.25rem;
  }
  .metric-label { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem; }
  .metric-value { font-size: 1.8rem; font-weight: 700; }
  .metric-value.green { color: var(--green); }
  .metric-value.red   { color: var(--red); }
  .metric-value.blue  { color: var(--blue); }
  .metric-value.yellow{ color: var(--yellow); }
  .metric-value.purple{ color: var(--purple); }

  .section-title { font-size: 1.1rem; font-weight: 600; margin: 2rem 0 1rem; }

  table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 0.75rem; overflow: hidden; border: 1px solid var(--border); }
  th { background: #162032; color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.75rem 1rem; text-align: left; }
  td { padding: 0.75rem 1rem; font-size: 0.85rem; border-top: 1px solid var(--border); vertical-align: middle; }
  tr:hover td { background: rgba(255,255,255,0.03); }

  .badge {
    display: inline-block; padding: 0.2rem 0.55rem; border-radius: 9999px;
    font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .badge.pass { background: rgba(16,185,129,0.15); color: var(--green); }
  .badge.fail { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge.warn { background: rgba(245,158,11,0.15); color: var(--yellow); }

  .lang-tag {
    display: inline-block; padding: 0.15rem 0.4rem; border-radius: 4px;
    font-size: 0.7rem; font-weight: 600; background: rgba(99,102,241,0.15); color: #818cf8;
  }

  .progress-bar { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 3px; }

  .latency-badge {
    padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;
  }
  .latency-fast   { background: rgba(16,185,129,0.15); color: var(--green); }
  .latency-medium { background: rgba(245,158,11,0.15); color: var(--yellow); }
  .latency-slow   { background: rgba(239,68,68,0.15);  color: var(--red); }

  .empathy-dots span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; }
  .empathy-dots .filled { background: var(--purple); }
  .empathy-dots .empty  { background: var(--border); }

  .lang-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .lang-card { background: var(--card); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem; }
  .lang-name { font-size: 0.8rem; font-weight: 600; color: var(--muted); text-transform: uppercase; margin-bottom: 0.5rem; }
  .lang-rate { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.4rem; }

  footer { margin-top: 3rem; color: var(--muted); font-size: 0.75rem; text-align: center; }

  .tag { display: inline-block; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.65rem;
         background: rgba(255,255,255,0.07); color: var(--muted); margin-right: 2px; }
  .failure-reason { font-size: 0.7rem; color: var(--red); }

  .check { color: var(--green); }
  .cross { color: var(--red); }
</style>
</head>
<body>

<h1>🏥 Kelly Agent Test Report</h1>
<p class="subtitle">Run at: ${RUN_AT} &nbsp;·&nbsp; Total cases: ${TOTAL}</p>

<!-- Summary metrics -->
<div class="grid">
  <div class="metric-card">
    <div class="metric-label">Pass Rate</div>
    <div class="metric-value $( [[ "$PASS_RATE" == "100" ]] && echo green || ([[ $(echo "$PASS_RATE < 70" | python3 -c "import sys; print(eval(sys.stdin.read()))") == "True" ]] && echo red || echo yellow) )">${PASS_RATE}%</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Passed / Failed</div>
    <div class="metric-value green">${PASSED}</div>
    <div style="font-size:0.9rem;color:var(--red)">${FAILED} failed</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Avg Latency</div>
    <div class="metric-value blue">${AVG_LATENCY}ms</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Avg Empathy</div>
    <div class="metric-value purple">${AVG_EMPATHY}/3</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Medical Error Rate</div>
    <div class="metric-value $( [[ "$MED_ERROR" == "0" ]] && echo green || echo red )">${MED_ERROR}%</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Tool Leaks</div>
    <div class="metric-value $( [[ "$TOOL_LEAKS" == "0" ]] && echo green || echo red )">${TOOL_LEAKS}</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Checkout Rate</div>
    <div class="metric-value blue">${CHECKOUT_RATE}%</div>
  </div>
</div>

<!-- By language -->
<div class="section-title">Results by Language</div>
<div class="lang-grid" id="langGrid"></div>

<!-- Case table -->
<div class="section-title">Case Details</div>
<table>
  <thead>
    <tr>
      <th>Case</th>
      <th>Lang</th>
      <th>Result</th>
      <th>Turns</th>
      <th>Latency</th>
      <th>Empathy</th>
      <th>Triage</th>
      <th>Checkout</th>
      <th>Specialty</th>
      <th>Failure</th>
    </tr>
  </thead>
  <tbody id="caseTableBody"></tbody>
</table>

<footer>Generated by Kelly E2E Test Suite · DocLittle</footer>

<script>
const BY_LANG = ${BY_LANG};
const CASES  = ${CASES_JSON};

// Language cards
const langGrid = document.getElementById('langGrid');
Object.entries(BY_LANG).forEach(([lang, d]) => {
  const rate = d.pass_rate;
  const color = rate >= 80 ? '#10b981' : rate >= 50 ? '#f59e0b' : '#ef4444';
  const card = document.createElement('div');
  card.className = 'lang-card';
  card.innerHTML = \`
    <div class="lang-name">\${lang.toUpperCase()}</div>
    <div class="lang-rate" style="color:\${color}">\${rate}%</div>
    <div style="font-size:0.8rem;color:#94a3b8">\${d.passed}/\${d.total} passed</div>
    <div class="progress-bar" style="margin-top:0.5rem">
      <div class="progress-fill" style="width:\${rate}%;background:\${color}"></div>
    </div>
  \`;
  langGrid.appendChild(card);
});

// Case table
const tbody = document.getElementById('caseTableBody');
CASES.sort((a, b) => (a.lang + a.case_id).localeCompare(b.lang + b.case_id));
CASES.forEach(c => {
  const m = c.metrics;
  const o = c.outcomes;

  // Latency badge
  const lat = m.avg_latency_ms;
  const latClass = lat < 3000 ? 'latency-fast' : lat < 8000 ? 'latency-medium' : 'latency-slow';

  // Empathy dots
  const emp = Math.round(m.avg_empathy_score);
  const dots = [0,1,2].map(i =>
    \`<span class="\${i < emp ? 'filled' : 'empty'}"></span>\`
  ).join('');

  const tags = (c.tags || '').split(',').filter(Boolean)
    .map(t => \`<span class="tag">\${t}</span>\`).join('');

  const row = document.createElement('tr');
  row.innerHTML = \`
    <td>
      <div style="font-weight:600;font-size:0.8rem">\${c.case_id}</div>
      <div style="font-size:0.7rem;color:#94a3b8;margin-top:2px">\${c.case_name}</div>
      <div style="margin-top:4px">\${tags}</div>
    </td>
    <td><span class="lang-tag">\${c.lang}</span></td>
    <td><span class="badge \${c.passed ? 'pass' : 'fail'}">\${c.passed ? 'PASS' : 'FAIL'}</span></td>
    <td style="font-weight:600">\${m.total_turns}</td>
    <td><span class="latency-badge \${latClass}">\${lat}ms</span></td>
    <td><div class="empathy-dots">\${dots}</div></td>
    <td class="\${o.triage_completed ? 'check' : 'cross'}">\${o.triage_completed ? '✓' : '✗'}</td>
    <td class="\${o.checkout_reached ? 'check' : 'cross'}">\${o.checkout_reached ? '✓' : '✗'}</td>
    <td class="\${o.correct_specialty ? 'check' : 'cross'}">\${o.correct_specialty ? '✓' : '—'}</td>
    <td class="failure-reason">\${c.failure_reasons !== 'none' ? c.failure_reasons : ''}</td>
  \`;
  tbody.appendChild(row);
});
</script>
</body>
</html>
HTMLEOF

echo "Report written to: $OUTPUT"

