/**
 * Optional API contract check for /api/patient/journal/calendar-range.
 * Requires PATIENT_TEST_SESSION_ID to run against a live middleware session.
 * Without session, exits 0 (skip).
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000';
const SESSION = process.env.PATIENT_TEST_SESSION_ID || '';

const headers = () => ({
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
  'x-session-id': SESSION,
});

async function main() {
  if (!SESSION) {
    console.log('SKIP: set PATIENT_TEST_SESSION_ID to run calendar-range API checks.');
    process.exit(0);
  }

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const qs = new URLSearchParams({
    start: toIso(start),
    end: toIso(end),
    timezone: 'America/New_York',
  });

  const res = await fetch(`${API_BASE}/api/patient/journal/calendar-range?${qs.toString()}`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    console.error('FAIL: calendar-range request', res.status, data);
    process.exit(1);
  }

  if (typeof data.has_template !== 'boolean') {
    console.error('FAIL: has_template missing/invalid', data);
    process.exit(1);
  }
  if (!data.range || !data.range.start || !data.range.end) {
    console.error('FAIL: range metadata missing', data);
    process.exit(1);
  }
  if (data.has_template && !Array.isArray(data.days)) {
    console.error('FAIL: days array missing when has_template=true', data);
    process.exit(1);
  }

  if (Array.isArray(data.days) && data.days.length) {
    const sample = data.days[0];
    const keys = ['date', 'is_routine_day', 'has_entry', 'completion_score', 'has_media', 'thumbnail_url'];
    for (const k of keys) {
      if (!(k in sample)) {
        console.error(`FAIL: sample day missing key ${k}`, sample);
        process.exit(1);
      }
    }
  }

  console.log('OK: patient journal calendar-range API contract checks passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
