/**
 * Optional API funnel check for patient journal + analytics (Phase 8).
 * Requires a real patient session: PATIENT_TEST_SESSION_ID=x-session value
 * and middleware listening at API_BASE (default http://localhost:4000).
 * Without PATIENT_TEST_SESSION_ID, exits 0 (skip).
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000';
const SESSION = process.env.PATIENT_TEST_SESSION_ID || '';

const headers = (extra = {}) => ({
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
  'x-session-id': SESSION,
  ...extra
});

async function main() {
  if (!SESSION) {
    console.log('SKIP: set PATIENT_TEST_SESSION_ID to run patient journal funnel API checks.');
    process.exit(0);
  }

  const r0 = await fetch(`${API_BASE}/api/patient/home/progress-summary`, { headers: headers() });
  const j0 = await r0.json().catch(() => ({}));
  if (!r0.ok || !j0.success) {
    console.error('FAIL: progress-summary', r0.status, j0);
    process.exit(1);
  }
  if (j0.has_template === false) {
    console.log('Note: no-template home summary path (has_template=false) OK.');
  }

  const rA = await fetch(`${API_BASE}/api/patient/analytics/event`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ event: 'home_summary_viewed' })
  });
  const jA = await rA.json().catch(() => ({}));
  if (!rA.ok || !jA.success) {
    console.error('FAIL: analytics event', rA.status, jA);
    process.exit(1);
  }

  const rBad = await fetch(`${API_BASE}/api/patient/analytics/event`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ event: 'template_created' })
  });
  if (rBad.status !== 400) {
    console.error('FAIL: analytics should reject non-whitelist client events', rBad.status);
    process.exit(1);
  }

  const rH = await fetch(`${API_BASE}/api/patient/health/catalog`, { headers: headers() });
  const jH = await rH.json().catch(() => ({}));
  if (!rH.ok || !jH.success || typeof jH.catalog_ok !== 'boolean') {
    console.error('FAIL: health catalog', rH.status, jH);
    process.exit(1);
  }

  const rTpl = await fetch(`${API_BASE}/api/patient/routine/template`, { headers: headers() });
  const jTpl = await rTpl.json().catch(() => ({}));
  if (!rTpl.ok || !jTpl.success) {
    console.error('FAIL: routine template GET', rTpl.status, jTpl);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const postTpl = await fetch(`${API_BASE}/api/patient/routine/template`, {
    method: 'POST',
    headers: headers({ 'idempotency-key': `pw-funnel-tpl-${Date.now()}` }),
    body: JSON.stringify({
      name: 'Funnel test routine',
      start_date: today,
      duration_days: 7,
      repeat_cadence: 'daily',
      repeat_days_of_week: [],
      items: [{ product_name: 'Test cleanser', usage_time: 'am', source_type: 'manual' }]
    })
  });
  const jPost = await postTpl.json().catch(() => ({}));
  if (!postTpl.ok || !jPost.success || !jPost.template_id) {
    console.error('FAIL: routine template POST', postTpl.status, jPost);
    process.exit(1);
  }

  const rTpl2 = await fetch(`${API_BASE}/api/patient/routine/template`, { headers: headers() });
  const jTpl2 = await rTpl2.json().catch(() => ({}));
  const itemId =
    jTpl2.template && Array.isArray(jTpl2.template.items) && jTpl2.template.items[0] && jTpl2.template.items[0].id
      ? String(jTpl2.template.items[0].id)
      : null;
  if (!itemId) {
    console.error('FAIL: could not read template item id after save', jTpl2);
    process.exit(1);
  }

  const dailyBody = {
    entry_date: today,
    skin_report: JSON.stringify({ version: 1, redness: null, oiliness: null, breakouts: null, detail: null }),
    notes: 'funnel test',
    item_logs: [{ template_item_id: itemId, completed: 1, notes: null }]
  };
  const rDaily = await fetch(`${API_BASE}/api/patient/routine/daily`, {
    method: 'POST',
    headers: headers({ 'idempotency-key': `pw-funnel-daily-${Date.now()}` }),
    body: JSON.stringify(dailyBody)
  });
  const jDaily = await rDaily.json().catch(() => ({}));
  if (!rDaily.ok || !jDaily.success) {
    console.error('FAIL: routine daily POST', rDaily.status, jDaily);
    process.exit(1);
  }

  const r1 = await fetch(`${API_BASE}/api/patient/home/progress-summary`, { headers: headers() });
  const j1 = await r1.json().catch(() => ({}));
  if (!r1.ok || !j1.success) {
    console.error('FAIL: progress-summary after save', r1.status, j1);
    process.exit(1);
  }

  console.log('OK: patient journal funnel API checks passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
