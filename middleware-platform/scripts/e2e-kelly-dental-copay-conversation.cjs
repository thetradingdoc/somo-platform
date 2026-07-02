#!/usr/bin/env node
'use strict';

/**
 * Phase 2 dental copay tool-chain E2E — scenarios 1–4 (direct tools, no full LLM).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.env.DB_PATH = process.env.DB_PATH || require('path').join(__dirname, '..', 'var/db/middleware-dev.db');
process.env.VOICE_ELIGIBILITY_SIMULATE = process.env.VOICE_ELIGIBILITY_SIMULATE || '1';

const path = require('path');
const crypto = require('crypto');

process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const { resolveAdminInsuranceCodes } = require('../services/resolve-admin-visit-codes');
const { resolveAmountDue, resolvePatientCheckoutAmount } = require('../services/resolve-amount-due');
const { TriagePolicy } = require('../services/conversation-mode/tenant-policy');
const journeyGates = require('../services/journey-gates-service');
const { collectInsurance } = require('../services/kelly-tool-executor/collect-insurance');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function seedDentalProfile(clinicId) {
  if (!db.db) return;
  const profileId = `prof_dental_e2e_${clinicId}`;
  db.db.prepare(`
    INSERT OR REPLACE INTO prompt_profiles (
      id, clinic_id, name, specialty, system_prompt, allowed_tools, status, use_case, policy_json, updated_at
    ) VALUES (?, ?, 'Dental E2E', 'Dental', 'dental e2e', ?, 'active', 'dental', ?, datetime('now'))
  `).run(
    profileId,
    clinicId,
    JSON.stringify(['collect_insurance', 'request_patient_payment', 'schedule_appointment']),
    JSON.stringify({ triage_policy: TriagePolicy.DISABLED })
  );
}

function seedFhirPatient(patientId, phone) {
  if (!db.db) return;
  const resolvedPhone =
    phone || `+1555${String(Date.now()).slice(-7)}${crypto.randomBytes(2).toString('hex')}`;
  const resource = JSON.stringify({
    resourceType: 'Patient',
    id: patientId,
    name: [{ family: 'E2E', given: ['Dental'] }]
  });
  db.db.prepare(`
    INSERT OR IGNORE INTO fhir_patients (resource_id, resource_data, phone, name, is_deleted)
    VALUES (?, ?, ?, 'Dental E2E', 0)
  `).run(patientId, resource, resolvedPhone);
}

function seedEligibilityRow({ patientId, copay, quality = 'hard_copay', payerId = 'DELTA_DENTAL_NY' }) {
  if (!db.db) return null;
  seedFhirPatient(patientId);
  const id = `elig_e2e_${crypto.randomBytes(4).toString('hex')}`;
  db.db.prepare(`
    INSERT INTO eligibility_checks (
      id, patient_id, member_id, payer_id, service_code, copay_amount, eligible,
      eligibility_quality, created_at
    ) VALUES (?, ?, ?, ?, 'D1110', ?, 1, ?, datetime('now'))
  `).run(id, patientId, 'MBR123456', payerId, copay, quality);
  return id;
}

function makeCollectExecutor({ patientId, copay = 20, quoteDelivered = true, quality = 'hard_copay' }) {
  return {
    _post: async (route, body) => {
      if (route !== '/voice/insurance/collect') throw new Error(`unexpected route ${route}`);
      const InsuranceService = require('../services/insurance-service');
      const pid = body.patient_id || patientId;
      const isThin = quality === 'thin';
      const elig = await InsuranceService.checkEligibility({
        patientId: pid,
        memberId: body.member_id,
        payerId: body.payer_id || 'DELTA_DENTAL_NY',
        serviceCode: body.primary_cpt || 'D1110',
        dateOfBirth: body.date_of_birth || '1990-01-15',
        dateOfService: new Date().toISOString().slice(0, 10)
      });
      if (db.db) {
        if (elig.eligibilityId) {
          try {
            db.db.prepare('DELETE FROM eligibility_checks WHERE id = ?').run(elig.eligibilityId);
          } catch (_) {}
        }
        seedEligibilityRow({
          patientId: pid,
          copay: isThin ? null : copay,
          quality
        });
      }
      return {
        success: true,
        payer_id: body.payer_id || 'DELTA_DENTAL_NY',
        payer_name: 'Delta Dental',
        member_id: body.member_id,
        patient_id: pid,
        coverage: { copay_amount: isThin ? null : copay, eligible: true },
        quote_delivered: !isThin && quoteDelivered,
        copay_due_now: isThin ? null : copay
      };
    }
  };
}

async function runCollect({
  sessionId,
  clinicId,
  patientId,
  executor,
  callerPhone = '+15551234567'
}) {
  seedFhirPatient(patientId, callerPhone);
  KellyToolExecutor._setSessionMeta(sessionId, 'visit_reason', 'cleaning');
  return collectInsurance(
    KellyToolExecutor,
    executor,
    {
      clinic_id: clinicId,
      member_id: 'MBR123456',
      payer_name: 'Delta Dental',
      payer_id: 'DELTA_DENTAL_NY',
      visit_reason: 'cleaning',
      date_of_birth: '1990-01-15',
      patient_id: patientId
    },
    { sessionId, patientId: null, callerPhone }
  );
}

async function scenario1HappyPath(clinicId) {
  console.log('Scenario 1 — happy path (hard copay + payment gate)');
  const sessionId = `dental_s1_${Date.now()}`;
  const patientId = `pat_s1_${crypto.randomBytes(4).toString('hex')}`;

  const admin = resolveAdminInsuranceCodes({ visit_reason: 'cleaning', tenantSpecialty: 'Dental' });
  assert(admin.ok && admin.primary_cpt === 'D1110', 'D1110 from cleaning');

  const copay = 20;
  const collectOut = await runCollect({
    sessionId,
    clinicId,
    patientId,
    executor: makeCollectExecutor({ patientId, copay, quality: 'hard_copay' })
  });
  assert(collectOut.success !== false, `collect_insurance failed: ${collectOut.error || collectOut.message}`);
  assert(KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') === '1', 'quote_delivered set');

  const paymentGate = journeyGates.checkPaymentGate({
    sessionFlags: { quote_delivered: KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') }
  });
  assert(paymentGate.allowed, 'payment gate open after hard quote');

  const amountResolved = await resolveAmountDue({ patientId, sessionId, serviceCode: 'D1110' });
  assert(amountResolved.status === 'hard_number', `resolveAmountDue hard_number, got ${amountResolved.status}`);
  assert(amountResolved.amount === copay, `copay parity ${amountResolved.amount} vs ${copay}`);

  const portalAmount = await resolvePatientCheckoutAmount({
    patientId,
    appointmentId: `appt_s1_${crypto.randomBytes(4).toString('hex')}`,
    clinicId,
    appointmentType: 'Dental Cleaning'
  });
  assert(portalAmount.ok && portalAmount.amount === copay, 'portal checkout matches voice copay');
  console.log('  ✅ Scenario 1 passed');
}

async function scenario2Thin271(clinicId) {
  console.log('Scenario 2 — thin 271 (defer, no payment)');
  const sessionId = `dental_s2_${Date.now()}`;
  const patientId = `pat_s2_${crypto.randomBytes(4).toString('hex')}`;

  const collectOut = await runCollect({
    sessionId,
    clinicId,
    patientId,
    executor: makeCollectExecutor({ patientId, copay: 20, quality: 'thin', quoteDelivered: false })
  });
  assert(collectOut.success !== false, `collect_insurance failed: ${collectOut.error || collectOut.message}`);
  assert(KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') !== '1', 'quote_delivered not set');

  const paymentGate = journeyGates.checkPaymentGate({
    sessionFlags: { quote_delivered: KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') }
  });
  assert(!paymentGate.allowed, 'payment gate blocked without hard quote');

  const amountResolved = await resolveAmountDue({ patientId, sessionId, serviceCode: 'D1110' });
  assert(amountResolved.status === 'thin', `thin status expected, got ${amountResolved.status}`);

  const portalAmount = await resolvePatientCheckoutAmount({
    patientId,
    appointmentId: `appt_s2_${crypto.randomBytes(4).toString('hex')}`,
    clinicId,
    appointmentType: 'Dental Cleaning'
  });
  assert(!portalAmount.ok && portalAmount.error === 'amount_pending_verification', 'portal checkout blocked for thin 271');
  console.log('  ✅ Scenario 2 passed');
}

async function scenario3BookAndCopay(clinicId) {
  console.log('Scenario 3 — book + copay same call');
  const sessionId = `dental_s3_${Date.now()}`;
  const patientId = `pat_s3_${crypto.randomBytes(4).toString('hex')}`;
  const appointmentId = `appt_s3_${crypto.randomBytes(4).toString('hex')}`;
  const copay = 35;

  const collectOut = await runCollect({
    sessionId,
    clinicId,
    patientId,
    executor: makeCollectExecutor({ patientId, copay, quality: 'hard_copay' })
  });
  assert(collectOut.success !== false, `collect_insurance failed: ${collectOut.error || collectOut.message}`);

  const bookingGate = journeyGates.checkBookingAfterQuoteGate({
    sessionFlags: { quote_delivered: KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') }
  });
  assert(bookingGate.allowed, 'booking gate open after quote_delivered');

  if (db.db) {
    db.db.prepare(`
      INSERT OR REPLACE INTO rcm_journeys (
        id, clinic_id, patient_id, appointment_id, status, amount_due, updated_at, created_at
      ) VALUES (?, ?, ?, ?, 'open', ?, datetime('now'), datetime('now'))
    `).run(`journey_${appointmentId}`, clinicId, patientId, appointmentId, copay);
  }

  const voiceAmount = await resolveAmountDue({ patientId, appointmentId, sessionId, serviceCode: 'D1110' });
  const portalAmount = await resolvePatientCheckoutAmount({
    patientId,
    appointmentId,
    clinicId,
    appointmentType: 'Dental Cleaning'
  });
  assert(voiceAmount.status === 'hard_number', 'voice amount hard_number');
  assert(portalAmount.ok, 'portal checkout resolves');
  assert(
    Math.abs(portalAmount.amount - voiceAmount.amount) < 0.01,
    `portal/voice parity ${portalAmount.amount} vs ${voiceAmount.amount}`
  );
  console.log('  ✅ Scenario 3 passed');
}

async function scenario4SelfPay(clinicId) {
  console.log('Scenario 4 — self-pay (no invented copay)');
  const sessionId = `dental_s4_${Date.now()}`;
  const patientId = `pat_s4_${crypto.randomBytes(4).toString('hex')}`;
  seedFhirPatient(patientId);

  KellyToolExecutor._setSessionMeta(sessionId, 'visit_reason', 'cleaning');
  assert(KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') !== '1', 'no quote without insurance collect');

  const amountResolved = await resolveAmountDue({ patientId, sessionId, serviceCode: 'D1110' });
  assert(
    amountResolved.status === 'cannot_determine' || amountResolved.amount === 0,
    `no hard copay without insurance: ${amountResolved.status}`
  );
  assert(amountResolved.status !== 'hard_number' || amountResolved.amount === 0, 'no invented copay');

  const paymentGate = journeyGates.checkPaymentGate({
    sessionFlags: { quote_delivered: KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') }
  });
  assert(!paymentGate.allowed, 'payment gate blocked without quote');

  if (db.db) {
    try {
      db.db.prepare(`
        INSERT OR REPLACE INTO visit_pricing (clinic_id, appointment_type, base_price, effective_price, updated_at)
        VALUES (?, 'Dental Cleaning', 150, 150, datetime('now'))
      `).run(clinicId);
    } catch (_) {}
  }

  const portalAmount = await resolvePatientCheckoutAmount({
    patientId,
    appointmentId: `appt_s4_${crypto.randomBytes(4).toString('hex')}`,
    clinicId,
    appointmentType: 'Dental Cleaning'
  });
  assert(portalAmount.ok, 'self-pay falls back to office fee');
  assert(portalAmount.amountDue?.status === 'self_pay', 'self-pay source tagged');
  assert(portalAmount.amount > 0, 'office fee resolved');
  console.log('  ✅ Scenario 4 passed');
}

async function scenario5PayLinkParity(clinicId) {
  console.log('Scenario 5 — voice quote === pay.html token (P2-087)');
  const sessionId = `dental_s5_${Date.now()}`;
  const patientId = `pat_s5_${crypto.randomBytes(4).toString('hex')}`;
  const copay = 25;

  const collectOut = await runCollect({
    sessionId,
    clinicId,
    patientId,
    executor: makeCollectExecutor({ patientId, copay, quality: 'hard_copay' })
  });
  assert(collectOut.success !== false, `collect_insurance failed: ${collectOut.error || collectOut.message}`);
  assert(KellyToolExecutor._getSessionMeta(sessionId, 'quote_delivered') === '1', 'quote_delivered set');

  const voiceQuoted = Number(KellyToolExecutor._getSessionMeta(sessionId, 'last_copay_due'));
  assert(voiceQuoted === copay, `voice quoted ${voiceQuoted} vs expected ${copay}`);

  const quoteGate = journeyGates.checkQuoteGate({
    quoteResult: { status: KellyToolExecutor._getSessionMeta(sessionId, 'last_quote_status') }
  });
  assert(quoteGate.allowed, 'checkQuoteGate allows hard quote before payment');

  const { createRcmPaymentRequest } = require('../services/rcm-payment-request-service');
  const payment = await createRcmPaymentRequest({
    clinicId,
    patientId,
    sessionId,
    method: 'kelly_e2e'
  });
  assert(payment.success, `createRcmPaymentRequest failed: ${payment.error || payment.message}`);
  assert(
    Math.abs(Number(payment.amount) - voiceQuoted) < 0.01,
    `RCM payment ${payment.amount} vs voice ${voiceQuoted}`
  );

  const settlement = require('../services/rcm-payment-settlement');
  const payCtx = await settlement.getPaymentContext(payment.pay_token);
  assert(payCtx.success, `getPaymentContext failed: ${payCtx.error}`);
  assert(
    Math.abs(Number(payCtx.payment.amount) - voiceQuoted) < 0.01,
    `pay.html token amount ${payCtx.payment.amount} vs voice ${voiceQuoted}`
  );
  console.log('  ✅ Scenario 5 passed');
}

async function run() {
  console.log('\n=== Phase 2 Dental Copay E2E (scenarios 1–5) ===\n');

  const clinicId = process.env.TEST_CLINIC_ID || 'clinic-default';
  seedDentalProfile(clinicId);

  await scenario1HappyPath(clinicId);
  await scenario2Thin271(clinicId);
  await scenario3BookAndCopay(clinicId);
  await scenario4SelfPay(clinicId);
  await scenario5PayLinkParity(clinicId);

  console.log('\n✅ All dental copay scenarios passed\n');
}

run().catch((e) => {
  console.error('❌', e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
