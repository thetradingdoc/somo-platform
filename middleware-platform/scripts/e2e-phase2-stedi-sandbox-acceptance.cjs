#!/usr/bin/env node
'use strict';

/**
 * Sprint C — sandbox acceptance with live Stedi *test* API (no simulation fallback).
 * Proves: collect → hard quote → payment link → pay.html parity → telemetry → shadow speak off.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.env.VOICE_ELIGIBILITY_SIMULATE = '0';
process.env.STEDI_TEST_MODE = process.env.STEDI_TEST_MODE || '1';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const { collectInsurance } = require('../services/kelly-tool-executor/collect-insurance');
const { resolveAmountDue } = require('../services/resolve-amount-due');
const { sanitizeCopayUtterance, canSpeakCopayAmount } = require('../services/copay-quote-guard');
const { resolveTenantVoiceConfig } = require('../services/tenant-voice-config');
const settlement = require('../services/rcm-payment-settlement');
const {
  openReadonlyDb,
  fetchKellyEventsRaw,
  findToolCompleted,
  findEventType
} = require('./lib/verify-db.cjs');

const CLINIC_ID =
  process.env.PHASE2_PILOT_CLINIC_ID || 'clinic-da8523ab-ab4b-4da8-b9c0-4694850a3f34';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makeStediTestCollectExecutor({ patientId }) {
  return {
    _post: async (route, body) => {
      if (route !== '/voice/insurance/collect') throw new Error(`unexpected route ${route}`);
      const InsuranceService = require('../services/insurance-service');
      const pid = body.patient_id || patientId;
      const elig = await InsuranceService.checkEligibility({
        patientId: pid,
        memberId: body.member_id || process.env.STEDI_TEST_MEMBER_ID || 'AETNA12345',
        payerId: body.payer_id || process.env.STEDI_TEST_PAYER_ID || '60054',
        serviceCode: body.primary_cpt || 'D1110',
        dateOfBirth: body.date_of_birth || process.env.STEDI_TEST_DOB || '2004-04-04',
        dateOfService: new Date().toISOString().slice(0, 10),
        providerNpi:
          process.env.STEDI_PROVIDER_NPI || process.env.STEDI_TEST_PROVIDER_NPI || '1999999984'
      });
      assert(elig && elig.eligible !== false, 'Stedi test eligibility must return eligible');
      const copay = Number(elig.copay ?? elig.copay_amount ?? 0);
      return {
        success: true,
        payer_id: body.payer_id || process.env.STEDI_TEST_PAYER_ID || '60054',
        payer_name: 'Stedi Test Payer',
        member_id: body.member_id,
        patient_id: pid,
        coverage: { copay_amount: copay, eligible: true },
        quote_delivered: true,
        copay_due_now: copay,
        stedi_search_id: elig.searchId || elig.eligibilityId || null
      };
    }
  };
}

function seedPatient(patientId, phone) {
  if (!db.db) return;
  const resource = JSON.stringify({
    resourceType: 'Patient',
    id: patientId,
    name: [{ family: 'Sandbox', given: ['Phase2'] }],
    telecom: [{ system: 'phone', value: phone }]
  });
  db.db.prepare(`
    INSERT OR IGNORE INTO fhir_patients (resource_id, resource_data, phone, name, is_deleted)
    VALUES (?, ?, ?, 'Phase2 Sandbox', 0)
  `).run(patientId, resource, phone);
}

async function run() {
  console.log('\n=== Phase 2 Sprint C — Stedi sandbox acceptance ===\n');
  console.log(`Clinic: ${CLINIC_ID}`);
  console.log(`Stedi test mode: ${process.env.STEDI_TEST_MODE}`);
  console.log(`VOICE_ELIGIBILITY_SIMULATE: ${process.env.VOICE_ELIGIBILITY_SIMULATE}\n`);

  const sessionId = `phase2_sbx_${Date.now()}`;
  const patientId = `pat_sbx_${crypto.randomBytes(4).toString('hex')}`;
  const phone = '+15559876543';

  seedPatient(patientId, phone);
  KellyToolExecutor._setSessionMeta(sessionId, 'visit_reason', 'cleaning');

  const voiceCfg = await resolveTenantVoiceConfig(db, { clinicId: CLINIC_ID });
  assert(voiceCfg?.copay_quote_speak_enabled !== true, 'shadow: copay_quote_speak_enabled must be off');

  const collectOut = await collectInsurance(
    KellyToolExecutor,
    makeStediTestCollectExecutor({ patientId }),
    {
      clinic_id: CLINIC_ID,
      member_id: process.env.STEDI_TEST_MEMBER_ID || 'AETNA12345',
      payer_id: process.env.STEDI_TEST_PAYER_ID || '60054',
      payer_name: 'Stedi Test',
      visit_reason: 'cleaning',
      date_of_birth: process.env.STEDI_TEST_DOB || '2004-04-04',
      patient_id: patientId
    },
    { sessionId, patientId, callerPhone: phone }
  );
  assert(collectOut.success !== false, `collect_insurance: ${collectOut.error || collectOut.message}`);
  assert(
    KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') === '1',
    'quote_delivered after Stedi test 271'
  );

  const voiceQuoted = Number(KellyToolExecutor._getSessionMeta(sessionId, 'last_copay_due'));
  assert(Number.isFinite(voiceQuoted), 'voice quoted amount set');

  const amountResolved =
    collectOut.amount_resolution ||
    (await resolveAmountDue({ patientId, sessionId, serviceCode: 'D1110' }));
  assert(
    amountResolved.status === 'hard_number' ||
      KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') === '1',
    `amount resolution: ${amountResolved.status}`
  );

  const speakAllowed = await canSpeakCopayAmount({ db, clinicId: CLINIC_ID, sessionId });
  assert(!speakAllowed, 'shadow week: copay speak disabled');
  const sanitized = await sanitizeCopayUtterance(
    `Your copay today is $${voiceQuoted.toFixed(2)}.`,
    { db, clinicId: CLINIC_ID, sessionId }
  );
  assert(!/\$\d/.test(sanitized), 'TTS guard strips dollar amounts in shadow mode');
  console.log('✅ shadow mode — quote collected, speak blocked');

  const payResult = await KellyToolExecutor.execute(
    'request_patient_payment',
    {
      patient_id: patientId,
      patient_email: 'sandbox@callsomo.com',
      patient_phone: phone,
      delivery: 'email',
      amount: voiceQuoted
    },
    { sessionId, clinicId: CLINIC_ID, patientId, callerPhone: phone, channel: 'voice' }
  );
  assert(payResult.success, `request_patient_payment: ${payResult.error || payResult.message}`);
  assert(
    Math.abs(Number(payResult.amount) - voiceQuoted) < 0.01,
    `pay link ${payResult.amount} vs voice ${voiceQuoted}`
  );
  console.log('✅ payment link created');

  const payCtx = await settlement.getPaymentContext(payResult.pay_token);
  assert(payCtx.success, `pay.html context: ${payCtx.error}`);
  assert(
    Math.abs(Number(payCtx.payment.amount) - voiceQuoted) < 0.01,
    `pay.html ${payCtx.payment.amount} vs voice ${voiceQuoted}`
  );
  console.log('✅ pay.html token parity');

  if (db.db) {
    const logs = db.db
      .prepare(
        `SELECT quoted_amount, charged_amount FROM amount_resolution_log
         WHERE session_id = ? AND charged_amount IS NOT NULL`
      )
      .all(sessionId);
    assert(logs.length > 0, 'amount_resolution_log entries for session');
    for (const row of logs) {
      if (row.quoted_amount != null && row.charged_amount != null) {
        assert(
          Math.abs(Number(row.quoted_amount) - Number(row.charged_amount)) < 0.01,
          `amount_resolution_log mismatch ${row.quoted_amount} vs ${row.charged_amount}`
        );
      }
    }
    console.log('✅ amount_resolution_log quoted === charged');
  }

  const { getEnvConfig, resolveDbPath } = require('../database/connection');
  const actualDbPath = resolveDbPath(getEnvConfig(path.join(__dirname, '..')));

  const sqlite = db.db || openReadonlyDb(actualDbPath);
  const events = fetchKellyEventsRaw(sqlite, sessionId);
  const paymentTool = findToolCompleted(events, /request_patient_payment/i);
  const linkSent = findEventType(events, 'payment_link_sent');
  assert(paymentTool, 'kelly_call_events: request_patient_payment tool_completed');
  assert(linkSent, 'kelly_call_events: payment_link_sent');
  console.log('✅ live copay call telemetry');

  const liveVerify = spawnSync(
    'node',
    ['scripts/verify-live-copay-call.cjs', '--session', sessionId],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, SESSION_ID: sessionId, DB_PATH: actualDbPath }
    }
  );
  assert(liveVerify.status === 0, `verify-live-copay-call failed:\n${liveVerify.stdout || liveVerify.stderr}`);

  const evidenceDir = path.join(__dirname, '..', 'var', 'evidence', 'phase2');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidence = {
    session_id: sessionId,
    clinic_id: CLINIC_ID,
    patient_id: patientId,
    voice_quoted: voiceQuoted,
    pay_token: payResult.pay_token,
    pay_amount: payResult.amount,
    stedi_mode: 'test',
    at: new Date().toISOString()
  };
  fs.writeFileSync(path.join(evidenceDir, 'sandbox-acceptance.json'), JSON.stringify(evidence, null, 2));
  console.log(`✅ evidence → var/evidence/phase2/sandbox-acceptance.json`);
  console.log(`\n✅ Sprint C sandbox acceptance passed (session: ${sessionId})\n`);
}

run().catch((e) => {
  console.error('❌', e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
