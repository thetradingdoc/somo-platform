#!/usr/bin/env node
/**
 * A2 smoke: two POSTs to /api/public/landing-assistant/turn with kelly_flow (matches littlelab-landing client).
 *
 * Prerequisites: middleware running, DEFAULT_CLINIC_ID or clinic_id in env/body.
 *
 *   cd middleware-platform && export DB_PATH=./middleware-dev.db
 *   npm start   # other terminal
 *   export DEFAULT_CLINIC_ID=your-clinic-uuid   # if required
 *   node scripts/smoke-landing-assistant-two-turn.cjs
 *
 * Optional: DB_PATH set → asserts kelly_session_meta_kv.routine_intake_active = 1 after turn 1.
 */

const { randomUUID } = require('crypto');
const path = require('path');

const base = (
  process.env.SMOKE_LANDING_BASE ||
  process.env.MIDDLEWARE_BASE_URL ||
  'http://127.0.0.1:4000'
).replace(/\/$/, '');
const clinicId = (process.env.DEFAULT_CLINIC_ID || process.env.SMOKE_CLINIC_ID || '').trim();
const dbPath = (process.env.DB_PATH || '').trim();

async function postTurn(body) {
  const res = await fetch(`${base}/api/public/landing-assistant/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.body = data;
    throw err;
  }
  return data;
}

function readRoutineIntakeMeta(sessionId) {
  if (!dbPath) return null;
  try {
    const Database = require('better-sqlite3');
    const abs = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
    const db = new Database(abs, { readonly: true, fileMustExist: false });
    const row = db
      .prepare(
        'SELECT value FROM kelly_session_meta_kv WHERE session_id = ? AND meta_key = ?'
      )
      .get(sessionId, 'routine_intake_active');
    db.close();
    return row?.value ?? null;
  } catch (e) {
    console.warn('⚠️  Could not read kelly_session_meta_kv (DB_PATH):', e.message);
    return null;
  }
}

async function main() {
  const sessionId = randomUUID();
  const bodyBase = {
    session_id: sessionId,
    kelly_flow: 'skincare',
    preferred_language: 'en'
  };
  if (clinicId) bodyBase.clinic_id = clinicId;

  console.log('Turn 1: establish concern + kelly_flow…');
  const t1 = await postTurn({
    ...bodyBase,
    message: 'I have acne on my cheeks.'
  });
  console.log('  → ok, session_id:', t1.session_id || sessionId);
  console.log('  → reply (first 120 chars):', String(t1.reply || '').slice(0, 120).replace(/\n/g, ' '));

  if (dbPath) {
    const meta = readRoutineIntakeMeta(t1.session_id || sessionId);
    if (meta !== '1') {
      throw new Error(
        `Expected routine_intake_active meta "1" in DB, got ${JSON.stringify(meta)}. Is kelly_flow accepted?`
      );
    }
    console.log('  → DB: routine_intake_active = 1 ✓');
  } else {
    console.log('  → (set DB_PATH to assert routine_intake_active in SQLite)');
  }

  console.log('Turn 2: same session — model should still know turn-1 concern (manual review of reply).');
  const t2 = await postTurn({
    ...bodyBase,
    session_id: t1.session_id || sessionId,
    message: 'What skin issue did I mention on my last message? One short phrase.'
  });
  console.log('  → ok');
  console.log('  → reply:', String(t2.reply || '').slice(0, 400).replace(/\n/g, ' '));

  console.log('\nSmoke passed: two HTTP 200s.' + (dbPath ? ' Meta check passed.' : ''));
}

main().catch((e) => {
  console.error('Smoke failed:', e.message);
  if (!clinicId) {
    console.error('Hint: set DEFAULT_CLINIC_ID (or SMOKE_CLINIC_ID) if the API returns 400 for missing clinic.');
  }
  process.exit(1);
});
