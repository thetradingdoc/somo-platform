#!/usr/bin/env node
/**
 * R-5: Measure billing pivot frequency during clinical OPQRST sessions.
 * Scans kelly_call_events for billing pivots while clinical/opqrst active.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
process.chdir(path.join(__dirname, '..'));

if (process.env.DB_PATH) {
  process.env.DB_PATH = path.resolve(process.env.DB_PATH);
}

const db = require('../../database');

function main() {
  const events = db.listKellyCallEvents?.({ limit: 5000 }) || [];
  let clinicalTurns = 0;
  let billingPivotDuringClinical = 0;

  for (const ev of events) {
    if (ev.event_type !== 'pivot_evaluated') continue;
    let payload = {};
    try {
      payload = typeof ev.payload_json === 'string' ? JSON.parse(ev.payload_json) : ev.payload_json || {};
    } catch (_) {}
    const priorClinical =
      payload.prior_mode === 'tenant_inbound_clinical' ||
      payload.conversation_mode === 'tenant_inbound_clinical';
    if (!priorClinical) continue;
    clinicalTurns += 1;
    if (payload.pivot_reason === 'billing_pivot') {
      billingPivotDuringClinical += 1;
    }
  }

  const pct = clinicalTurns ? (100 * billingPivotDuringClinical) / clinicalTurns : 0;
  console.log(JSON.stringify({
    db_path: process.env.DB_PATH || '(default)',
    profile: process.env.R5A_PROFILE || 'local',
    clinical_pivot_events: clinicalTurns,
    billing_pivot_during_clinical: billingPivotDuringClinical,
    pct: Number(pct.toFixed(2)),
    go_no_go:
      pct >= 10 ? 'block_pr1_prod_without_pr2' : pct >= 3 ? 'staging_non_billing_only' : 'same_train_ok'
  }, null, 2));
}

try {
  main();
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
