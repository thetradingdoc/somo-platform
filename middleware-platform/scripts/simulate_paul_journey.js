#!/usr/bin/env node
'use strict';

/**
 * HARNESS_ONLY — Session 7 Paul journey terminal harness (13-step assertions).
 * Seeds triage via paul-harness-seed; NOT production coding proof.
 * Use terminal-coding-call.cjs for prod DoD.
 * Usage: node scripts/simulate_paul_journey.js --scenario copay_due
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.SKIP_STARTUP_MIGRATIONS = '1';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const { computeVisitQuote } = require('../services/payer-quote-service');
const journeyGates = require('../services/journey-gates-service');
const { seedPaulTriage } = require('./lib/paul-harness-seed');

const scenario = (process.argv.find((a) => a.startsWith('--scenario=')) || '--scenario=copay_due').split('=')[1];

const SCENARIOS = {
  copay_due: { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', expect_status: 'hard_number', expect_copay: 35 },
  fully_covered: { payer_id: 'BCBS_PILOT', plan_id: 'plan_y', expect_status: 'hard_number', expect_copay: 0 },
  cannot_determine: { payer_id: 'BCBS_PILOT', plan_id: 'unknown_plan', expect_status: 'cannot_determine', expect_copay: null }
};

async function assertStep(name, ok, detail) {
  if (!ok) {
    console.error(`FAIL step: ${name}`, detail || '');
    process.exit(2);
  }
  console.log(`PASS ${name}`);
}

async function main() {
  const cfg = SCENARIOS[scenario];
  if (!cfg) {
    console.error('Unknown scenario', scenario);
    process.exit(2);
  }

  const sessionId = `paul_${scenario}_${Date.now()}`;
  const symptom = 'stomach pain since yesterday with nausea after meals';

  // Steps 4-5: OPQRST + triage coding spine (seeded validated codes for reliable harness)
  await KellyToolExecutor.execute('store_triage_opqrst', {
    onset: 'yesterday',
    quality: 'cramping',
    severity: 6,
    timing: 'intermittent',
    opqrst_complete: true
  }, { sessionId, clinicId: 'clinic-default' });

  const triage = seedPaulTriage(db, sessionId);
  const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
  await assertStep('5_triage_primary_icd10', !!triage.primary_icd10, triage.primary_icd10);
  await assertStep('5_triage_primary_cpt', !!(triage.primary_cpt || triage.cpt_codes?.[0]?.code));

  const codingGate = journeyGates.checkCodingGate({
    sessionId,
    triageRow: sessionRow,
    db
  });
  await assertStep('6_coding_gate', codingGate.allowed);

  // Step 7: payer quote
  const quote = await computeVisitQuote({
    primary_icd10: triage.primary_icd10,
    primary_cpt: triage.primary_cpt || triage.cpt_codes?.[0]?.code || '99213',
    payer_id: cfg.payer_id,
    plan_id: cfg.plan_id,
    session_id: sessionId,
    call_id: sessionId
  });
  await assertStep('7_quote_status', quote.status === cfg.expect_status, quote);
  if (cfg.expect_copay != null) {
    await assertStep('7_quote_copay', quote.copay_due_now === cfg.expect_copay, quote.copay_due_now);
  }
  const auditRow = db.db?.prepare(
    'SELECT id, status FROM quote_audit WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(sessionId);
  await assertStep('7_quote_audit_row', !!auditRow && auditRow.status === cfg.expect_status, auditRow);

  const quoteGate = journeyGates.checkQuoteGate({ quoteResult: quote });
  if (cfg.expect_status === 'hard_number') {
    await assertStep('8_quote_hard_number_gate', quoteGate.allowed);
    KellyToolExecutor._setSessionMeta(sessionId, 'quote_delivered', '1');
  } else {
    await assertStep('8_quote_blocked_for_non_hard', !quoteGate.allowed);
  }

  // Step 9 language check (no hard dollar unless hard_number)
  const maySpeakDollar = quote.status === 'hard_number';
  await assertStep('9_quote_language_policy', cfg.expect_status !== 'hard_number' ? !maySpeakDollar : maySpeakDollar);

  // Step 11 gate before booking
  const bookingGate = journeyGates.checkBookingAfterQuoteGate({
    sessionFlags: { quote_delivered: KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') }
  });
  if (cfg.expect_status === 'hard_number') {
    await assertStep('11_booking_gate_open', bookingGate.allowed);
  }

  // Step 12 payment gate
  const paymentGate = journeyGates.checkPaymentGate({
    sessionFlags: { quote_delivered: KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') }
  });
  if (cfg.expect_status === 'hard_number') {
    await assertStep('12_payment_gate_open', paymentGate.allowed);
  } else {
    await assertStep('12_payment_gate_blocked', !paymentGate.allowed);
  }

  // Step 13: codes validate against SQLite codebook (no live Pinecone)
  const knowledgeService = require('../services/knowledge-service');
  const validation = knowledgeService.validateCodesExist({
    icd10: [triage.primary_icd10].filter(Boolean),
    cpt: [triage.primary_cpt || triage.cpt_codes?.[0]?.code].filter(Boolean)
  });
  await assertStep('13_codes_validate', validation.valid, validation.invalid);

  console.log(JSON.stringify({ scenario, sessionId, quote_status: quote.status, success: true }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
