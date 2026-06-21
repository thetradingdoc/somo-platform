#!/usr/bin/env node
'use strict';

/**
 * Phase 1 D1 — payer model verification (BCBS_PILOT aligned with fee_schedules).
 */

const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const { computeVisitQuote } = require('../services/payer-quote-service');
const db = require('../database').db;

const PAYER = 'BCBS_PILOT';

try {
  execSync('node seeds/pilot-payer-rules.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
} catch (_) {}

const SCENARIOS = [
  { name: 'copay_due', plan_id: 'plan_x', expect_status: 'hard_number', expect_copay: 35, expect_allowed: true },
  { name: 'fully_covered', plan_id: 'plan_y', expect_status: 'hard_number', expect_copay: 0, expect_allowed: true },
  { name: 'cannot_determine', plan_id: 'unknown_plan', expect_status: 'cannot_determine', expect_copay: null, expect_allowed: false }
];

async function main() {
  const results = [];
  for (const s of SCENARIOS) {
    const sessionId = `payer_${s.name}_${Date.now()}`;
    const quote = await computeVisitQuote({
      primary_icd10: 'K21.0',
      primary_cpt: '99213',
      payer_id: PAYER,
      plan_id: s.plan_id,
      session_id: sessionId,
      call_id: sessionId
    });
    const audit = db.prepare(
      'SELECT id, status, result_json FROM quote_audit WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(sessionId);
    let allowedFromJson = null;
    try {
      allowedFromJson = JSON.parse(audit?.result_json || '{}').allowed_amount;
    } catch (_) {}
    const feeRow = db.prepare(
      'SELECT allowed_amount FROM fee_schedules WHERE payer_id = ? AND cpt_code = ? LIMIT 1'
    ).get(PAYER, '99213');
    const ok =
      quote.status === s.expect_status &&
      (s.expect_copay == null || quote.copay_due_now === s.expect_copay) &&
      !!audit &&
      (s.expect_allowed ? (quote.allowed_amount != null || allowedFromJson != null) && feeRow?.allowed_amount != null : true);
    results.push({
      scenario: s.name,
      ok,
      quote,
      audit_id: audit?.id,
      fee_schedule_allowed: feeRow?.allowed_amount,
      payer_id_aligned: !!feeRow
    });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(JSON.stringify({ payer_id: PAYER, results, success: failed === 0 }, null, 2));
  process.exit(failed ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
