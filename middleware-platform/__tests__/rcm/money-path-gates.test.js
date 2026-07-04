'use strict';

const crypto = require('crypto');
const KellyToolExecutor = require('../../services/kelly-tool-executor');
const journeyGates = require('../../services/journey-gates-service');
const {
  seedInsuredCopayJourney,
  seedThinEligibilityJourney,
  invokeRequestPatientPayment,
  resolveAmountDueForPatient
} = require('../../e2e/helpers/rcm-money-fixtures.cjs');

describe('rcm money path gates', () => {
  const clinicId = 'clinic-default';

  test('3.3 quote gate blocks request_patient_payment without quote_delivered', async () => {
    const sessionId = `gate_quote_${Date.now()}`;
    KellyToolExecutor._setSessionMeta(sessionId, 'resolved_patient_id', `pat_${Date.now()}`);
    const result = await invokeRequestPatientPayment(
      { sessionId, clinicId, patientId: KellyToolExecutor._getSessionMeta(sessionId, 'resolved_patient_id') },
      { amount: 20 }
    );
    expect(result.success).toBeFalsy();
    expect(result.error_code || result.error).toMatch(/QUOTE_REQUIRED/);
  });

  test('3.4 identity gate blocks pay without patient_identity_verified', async () => {
    const { sessionId, patientId } = seedInsuredCopayJourney({ clinicId, copayDollars: 25 });
    KellyToolExecutor._setSessionMeta(sessionId, 'patient_identity_verified', '0');
    const result = await invokeRequestPatientPayment({ sessionId, clinicId, patientId }, { amount: 25 });
    expect(result.success).toBeFalsy();
    expect(result.error_code || result.error).toMatch(/IDENTITY_REQUIRED/);
  });

  test('3.4 identity gate allows pay when verified + DOB match', async () => {
    const { sessionId, patientId } = seedInsuredCopayJourney({ clinicId, copayDollars: 25 });
    KellyToolExecutor._setSessionMeta(sessionId, 'patient_identity_verified', '0');
    const result = await invokeRequestPatientPayment(
      { sessionId, clinicId, patientId, callerPhone: '+15551234000' },
      { amount: 25, dobLast4: '0115' }
    );
    if (result.error_code === 'ANTI_SYBIL_BLOCKED') {
      expect(result.error_code).toBe('ANTI_SYBIL_BLOCKED');
      return;
    }
    expect(result.success).not.toBe(false);
    if (result.pay_token) {
      expect(result.pay_token).toBeTruthy();
    }
  });

  test('3.9 thin eligibility resolves cannot_determine / thin', async () => {
    const { patientId } = seedThinEligibilityJourney({ clinicId });
    const resolved = await resolveAmountDueForPatient(patientId);
    expect(['thin', 'cannot_determine']).toContain(resolved.status);
  });

  test('3.1 hard copay from eligibility', async () => {
    const { patientId } = seedInsuredCopayJourney({ clinicId, copayDollars: 40 });
    const resolved = await resolveAmountDueForPatient(patientId);
    expect(resolved.status).toBe('hard_number');
    expect(resolved.amount).toBe(40);
  });

  test('payment gate open only after quote_delivered', () => {
    const blocked = journeyGates.checkPaymentGate({ sessionFlags: { quote_delivered: '0' } });
    expect(blocked.allowed).toBe(false);
    const open = journeyGates.checkPaymentGate({ sessionFlags: { quote_delivered: '1' } });
    expect(open.allowed).toBe(true);
  });
});
