'use strict';

const {
  checkHardCopaySpoken,
  checkReplyToolCoherence,
  checkReplyLocale,
  checkRescheduleReplyCoherence,
  checkPaymentSmsCoherence,
  isCopayPaymentScenario,
  truthyMeta
} = require('../e2e/helpers/multilang-eval-assertions.cjs');

describe('multilang-eval-assertions', () => {
  test('truthyMeta accepts common truthy session values', () => {
    expect(truthyMeta('1')).toBe(true);
    expect(truthyMeta(true)).toBe(true);
    expect(truthyMeta('0')).toBe(false);
  });

  test('checkHardCopaySpoken fails when hard copay but no dollar in transcript', () => {
    const result = checkHardCopaySpoken(
      { copayScenario: true },
      {
        sessionMeta: { last_quote_status: 'hard_number', quote_delivered: '1', last_copay_due: '25' },
        transcript: [{ role: 'assistant', text: 'Thanks — I verified your coverage.' }],
        finalReply: 'Thanks — I verified your coverage.'
      }
    );
    expect(result.pass).toBe(false);
  });

  test('checkHardCopaySpoken passes when dollar spoken', () => {
    const result = checkHardCopaySpoken(
      { copayScenario: true },
      {
        sessionMeta: { last_quote_status: 'hard_number', quote_delivered: '1' },
        transcript: [{ role: 'assistant', text: 'Your copay is $25.00 today.' }],
        finalReply: 'Your copay is $25.00 today.'
      }
    );
    expect(result.pass).toBe(true);
  });

  test('isCopayPaymentScenario false for eligibility-only scenario', () => {
    expect(
      isCopayPaymentScenario({ copayPayment: false, evalTags: ['copay_eligibility'] })
    ).toBe(false);
    expect(
      isCopayPaymentScenario({ copayPayment: true, evalTags: ['copay_payment'] })
    ).toBe(true);
  });

  test('checkReplyToolCoherence skips payment assert for eligibility scenario', () => {
    const findings = checkReplyToolCoherence(
      { copayPayment: false, evalTags: ['copay_eligibility'] },
      { toolsUsed: [], finalReply: 'ok', transcript: [], sessionMeta: {} },
      { sessionId: null, dbModule: null }
    );
    expect(findings.some((f) => f.check.includes('request_patient_payment'))).toBe(false);
  });

  test('checkReplyToolCoherence fails when schedule ran but success false', () => {
    const findings = checkReplyToolCoherence(
      { expectedTools: ['schedule_appointment'] },
      {
        toolsUsed: ['schedule_appointment'],
        finalReply: 'I was not able to complete that booking.',
        transcript: [],
        sessionMeta: { schedule_appointment_success: false }
      },
      { sessionId: null, dbModule: null }
    );
    expect(findings.some((f) => f.check.includes('did not succeed'))).toBe(true);
  });

  test('checkRescheduleReplyCoherence fails cancel-only reply', () => {
    const result = checkRescheduleReplyCoherence(
      { expectReschedule: true },
      {
        toolsUsed: ['reschedule_appointment'],
        transcript: [{ role: 'assistant', text: 'Your appointment has been canceled.' }],
        finalReply: 'Your appointment has been canceled.'
      }
    );
    expect(result.pass).toBe(false);
  });

  test('checkReplyToolCoherence fails schedule success with failure reply', () => {
    const findings = checkReplyToolCoherence(
      { expectedTools: ['schedule_appointment'] },
      {
        toolsUsed: ['schedule_appointment'],
        finalReply: 'I was not able to complete that booking. Let me connect you with our front desk.',
        transcript: [],
        sessionMeta: { schedule_appointment_success: true }
      },
      { sessionId: null, dbModule: null }
    );
    const contradict = findings.find((f) => f.check.includes('must not contradict'));
    expect(contradict?.pass).toBe(false);
  });

  test('checkReplyLocale flags English success on Spanish scenario', () => {
    const result = checkReplyLocale(
      { lang: 'es', locale: 'es-US' },
      {
        transcript: [{ role: 'assistant', text: 'Thanks — I verified your coverage.' }],
        finalReply: 'Thanks — I verified your coverage.'
      }
    );
    expect(result.pass).toBe(false);
  });

  test('checkPaymentSmsCoherence fails undefined and commerce copy', () => {
    const dbModule = {
      db: {
        prepare: () => ({
          get: () => ({
            payload_json: JSON.stringify({
              sms_body: 'undefined: Complete your order for Copay ($25): https://x'
            })
          })
        })
      }
    };
    const result = checkPaymentSmsCoherence(
      { copayPayment: true, evalTags: ['copay_payment'], lang: 'en', locale: 'en-US' },
      'sess-1',
      dbModule
    );
    expect(result.pass).toBe(false);
    expect(result.subchecks.some((c) => c.check.includes('undefined') && !c.pass)).toBe(true);
    expect(result.subchecks.some((c) => c.check.includes('commerce') && !c.pass)).toBe(true);
  });

  test('checkPaymentSmsCoherence passes valid ES copay SMS', () => {
    const dbModule = {
      db: {
        prepare: () => ({
          get: () => ({
            payload_json: JSON.stringify({
              sms_body: 'Clínica: Su copago estimado es $20.00. Pague de forma segura: https://pay'
            })
          })
        })
      }
    };
    const result = checkPaymentSmsCoherence(
      { copayPayment: true, evalTags: ['copay_payment'], lang: 'es', locale: 'es-US' },
      'sess-2',
      dbModule
    );
    expect(result.pass).toBe(true);
  });
});
