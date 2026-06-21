#!/usr/bin/env node
'use strict';

/**
 * Session 4 — 3-scenario payer quote terminal harness.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.DB_PATH = process.env.DB_PATH || './var/db/middleware-dev.db';
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const { execSync } = require('child_process');
const { computeVisitQuote } = require('../services/payer-quote-service');
const db = require('../database');

const SCENARIOS = [
  { name: 'copay_due', payer_id: 'BCBS_PILOT', plan_id: 'plan_x', icd: 'K21.0', cpt: '99213', expect_status: 'hard_number', expect_copay: 35 },
  { name: 'fully_covered', payer_id: 'BCBS_PILOT', plan_id: 'plan_y', icd: 'K21.0', cpt: '99213', expect_status: 'hard_number', expect_copay: 0 },
  { name: 'cannot_determine', payer_id: 'BCBS_PILOT', plan_id: 'unknown_plan', icd: 'K21.0', cpt: '99213', expect_status: 'cannot_determine', expect_copay: null }
];

async function main() {
  try {
    execSync('node seeds/pilot-payer-rules.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  } catch (_) {}

  const results = [];
  let failed = 0;

  for (const s of SCENARIOS) {
    const sessionId = `quote_${s.name}_${Date.now()}`;
    const quote = await computeVisitQuote({
      primary_icd10: s.icd,
      primary_cpt: s.cpt,
      payer_id: s.payer_id,
      plan_id: s.plan_id,
      session_id: sessionId,
      call_id: sessionId
    });
    const audit = db.db.prepare(
      'SELECT id, status, copay_due_now FROM quote_audit WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(sessionId);
    const ok =
      quote.status === s.expect_status &&
      (s.expect_copay == null || quote.copay_due_now === s.expect_copay) &&
      audit?.status === s.expect_status;
    if (!ok) failed += 1;
    results.push({ scenario: s.name, ok, quote, audit_id: audit?.id || null });
  }

  console.log(JSON.stringify({ results, success: failed === 0 }, null, 2));
  process.exit(failed ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
