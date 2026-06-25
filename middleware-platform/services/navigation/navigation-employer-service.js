'use strict';

const db = require('../../database');
const { METRO_ENTITY_ID } = require('../../scripts/lib/navigation-demo-config.cjs');

function ensureEmployerPlansTable() {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS employer_plans (
      id TEXT PRIMARY KEY,
      employer_id TEXT NOT NULL UNIQUE,
      employer_name TEXT NOT NULL,
      payor_entity_id TEXT NOT NULL,
      payer_id TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_employer_plans_payor ON employer_plans(payor_entity_id);
  `);
}

function seedDemoEmployerPlan() {
  ensureEmployerPlansTable();
  const employerId = process.env.NAVIGATION_DEMO_EMPLOYER_ID || 'employer_metro_demo';
  db.db
    .prepare(
      `INSERT INTO employer_plans (id, employer_id, employer_name, payor_entity_id, payer_id, status)
       VALUES (?, ?, ?, ?, ?, 'active')
       ON CONFLICT(employer_id) DO UPDATE SET
         payor_entity_id = excluded.payor_entity_id,
         payer_id = excluded.payer_id,
         updated_at = datetime('now')`
    )
    .run(`empl_${employerId}`, employerId, 'Metro Employer Demo', METRO_ENTITY_ID, 'METRO-HEALTH-PLUS');
  return employerId;
}

function resolveEmployerMember({ employer_code, member_id } = {}) {
  ensureEmployerPlansTable();
  const code = String(employer_code || '').trim().toLowerCase();
  const member = String(member_id || '').trim();
  if (!code || !member) {
    return { success: false, error: 'employer_code_and_member_id_required' };
  }

  const row = db.db
    .prepare(
      `SELECT * FROM employer_plans WHERE lower(employer_id) = ? AND status = 'active' LIMIT 1`
    )
    .get(code);
  if (!row) {
    return { success: false, error: 'employer_not_found' };
  }

  const payor = db.db
    .prepare('SELECT canonical_name, canonical_payer_id FROM payor_canonical_entities WHERE id = ?')
    .get(row.payor_entity_id);

  return {
    success: true,
    employer_id: row.employer_id,
    employer_name: row.employer_name,
    member_id: member,
    payor_entity_id: row.payor_entity_id,
    payer_id: row.payer_id || payor?.canonical_payer_id,
    plan_display_name: payor?.canonical_name || 'Metro Health Plus'
  };
}

function reportEmployerUtilization(employerId) {
  ensureEmployerPlansTable();
  const rows = db.db
    .prepare(
      `SELECT event_type, payload_json, created_at
       FROM kelly_call_events
       WHERE event_type IN ('navigation_event', 'tool_completed')
       ORDER BY created_at DESC
       LIMIT 500`
    )
    .all();
  let booked = 0;
  let navigationCalls = 0;
  for (const row of rows) {
    try {
      const p = JSON.parse(row.payload_json || '{}');
      if (p.event === 'appointment_booked') booked += 1;
      if (p.routing_world === 'navigation' || p.event) navigationCalls += 1;
      if (p.employer_id === employerId && p.event === 'appointment_booked') booked += 0;
    } catch (_) {}
  }
  return {
    employer_id: employerId,
    navigation_events_sampled: navigationCalls,
    booked_visits_estimated: booked
  };
}

module.exports = {
  ensureEmployerPlansTable,
  seedDemoEmployerPlan,
  resolveEmployerMember,
  reportEmployerUtilization
};
