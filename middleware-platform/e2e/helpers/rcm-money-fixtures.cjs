'use strict';

/**
 * RCM money-path test fixtures — in-process seeds and tool invocation.
 */

const crypto = require('crypto');

const fixtures = require('./kelly-conversation-fixtures.cjs');
const { assertSessionCopayParity } = require('./copay-desk-parity.cjs');
const { resolveAmountDue } = require('../../services/resolve-amount-due');
const KellyToolExecutor = require('../../services/kelly-tool-executor');

function seedEligibilityRow(dbModule, { patientId, copay, quality = 'hard_copay' }) {
  if (!dbModule.db) return null;
  const id = `elig_rcm_${crypto.randomBytes(4).toString('hex')}`;
  dbModule.db
    .prepare(
      `INSERT INTO eligibility_checks (
        id, patient_id, member_id, payer_id, service_code, copay_amount, eligible,
        eligibility_quality, created_at
      ) VALUES (?, ?, ?, ?, 'D1110', ?, 1, ?, datetime('now'))`
    )
    .run(id, patientId, 'MBR123456', 'DELTA_DENTAL_NY', copay, quality);
  return id;
}

function seedFhirPatientMinimal(dbModule, patientId, phone) {
  const resolvedPhone =
    phone || require('./e2e-phone.cjs').e2eTestPhoneE164();
  if (dbModule.createFHIRPatient) {
    try {
      const rid = patientId.replace(/^Patient\//, '');
      dbModule.createFHIRPatient({
        resourceType: 'Patient',
        id: rid,
        name: [{ family: 'E2E', given: ['RCM'] }],
        telecom: [{ system: 'phone', value: resolvedPhone }],
        birthDate: '1990-01-15'
      });
      const row = dbModule.getFHIRPatient?.(rid) || dbModule.getFHIRPatient?.(`Patient/${rid}`);
      return row?.resource_id || rid;
    } catch (_) {}
  }
  if (!dbModule.db) return patientId;
  const rid = patientId.replace(/^Patient\//, '');
  dbModule.db
    .prepare(
      `INSERT OR IGNORE INTO fhir_patients (resource_id, resource_data, phone, name, is_deleted)
       VALUES (?, ?, ?, 'RCM E2E', 0)`
    )
    .run(
      rid,
      JSON.stringify({
        resourceType: 'Patient',
        id: rid,
        name: [{ family: 'E2E', given: ['RCM'] }],
        birthDate: '1990-01-15'
      }),
      resolvedPhone
    );
  return rid;
}

function seedInsuredCopayJourney({ clinicId, copayDollars = 20, patientId, sessionId } = {}) {
  const sid = sessionId || fixtures.newE2eSessionId('rcm_copay');
  const pid = patientId || `pat_rcm_${crypto.randomBytes(4).toString('hex')}`;
  const cid = clinicId || process.env.TEST_CLINIC_ID || 'clinic-default';
  const { dbModule } = fixtures.loadDb();

  fixtures.seedDentalFrontDeskSession(sid, cid, { utterances: ['copay fixture'], seedProvider: false });
  const resolvedPid = seedFhirPatientMinimal(dbModule, pid);
  seedEligibilityRow(dbModule, { patientId: resolvedPid, copay: copayDollars, quality: 'hard_copay' });

  KellyToolExecutor._setSessionMeta(sid, 'visit_reason', 'cleaning');
  KellyToolExecutor._setSessionMeta(sid, 'quote_delivered', '1');
  KellyToolExecutor._setSessionMeta(sid, 'last_quote_status', 'hard_number');
  KellyToolExecutor._setSessionMeta(sid, 'last_copay_due', String(copayDollars));
  KellyToolExecutor._setSessionMeta(sid, 'patient_identity_verified', '1');
  KellyToolExecutor._setSessionMeta(sid, 'resolved_patient_id', resolvedPid);

  return { sessionId: sid, patientId: resolvedPid, clinicId: cid, copayDollars };
}

function seedThinEligibilityJourney({ clinicId, patientId, sessionId } = {}) {
  const sid = sessionId || fixtures.newE2eSessionId('rcm_thin');
  const pid = patientId || `pat_thin_${crypto.randomBytes(4).toString('hex')}`;
  const cid = clinicId || process.env.TEST_CLINIC_ID || 'clinic-default';
  const { dbModule } = fixtures.loadDb();

  fixtures.seedDentalFrontDeskSession(sid, cid, {
    thinEligibility: true,
    utterances: ['thin eligibility'],
    seedProvider: false
  });
  const resolvedPid = seedFhirPatientMinimal(dbModule, pid);
  seedEligibilityRow(dbModule, { patientId: resolvedPid, copay: null, quality: 'thin' });

  return { sessionId: sid, patientId: resolvedPid, clinicId: cid };
}

async function invokeRequestPatientPayment(ctx, opts = {}) {
  const sessionId = ctx.sessionId;
  const clinicId = ctx.clinicId || process.env.TEST_CLINIC_ID || 'clinic-default';
  const patientId = ctx.patientId || KellyToolExecutor._getSessionMeta(sessionId, 'resolved_patient_id');

  return KellyToolExecutor.execute(
    'request_patient_payment',
    {
      amount: opts.amount,
      journey_id: opts.journeyId || null,
      patient_id: patientId,
      patient_dob_last4: opts.dobLast4,
      delivery: opts.delivery || 'sms'
    },
    {
      sessionId,
      clinicId,
      patientId,
      callerPhone: ctx.callerPhone || '+15551234567',
      channel: 'voice'
    }
  );
}

async function resolveAmountDueForPatient(patientId, opts = {}) {
  return resolveAmountDue({
    patientId,
    sessionId: opts.sessionId,
    serviceCode: opts.serviceCode || 'D1110'
  });
}

module.exports = {
  seedInsuredCopayJourney,
  seedThinEligibilityJourney,
  invokeRequestPatientPayment,
  resolveAmountDueForPatient,
  assertSessionCopayParity
};
